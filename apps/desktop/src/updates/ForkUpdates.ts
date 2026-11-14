// @effect-diagnostics nodeBuiltinImport:off -- Fork-only boundary: it runs fork/sync.sh and hands the install to a detached shell that outlives the app.
// Fork-only updater: the sidebar's update button merges upstream into this fork with
// fork/sync.sh, builds it, and restarts into the build instead of downloading a release.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type {
  DesktopUpdateActionResult,
  DesktopUpdateCheckResult,
  DesktopUpdateReleaseNote,
  DesktopUpdateState,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as IpcChannels from "../ipc/channels.ts";
import { DesktopUpdates } from "./DesktopUpdates.ts";
import {
  createInitialDesktopUpdateState,
  reduceDesktopUpdateStateOnCheckFailure,
  reduceDesktopUpdateStateOnCheckStart,
  reduceDesktopUpdateStateOnDownloadComplete,
  reduceDesktopUpdateStateOnDownloadFailure,
  reduceDesktopUpdateStateOnDownloadStart,
  reduceDesktopUpdateStateOnNoUpdate,
  reduceDesktopUpdateStateOnUpdateAvailable,
} from "./updateMachine.ts";

const HOME = NodeOS.homedir();
// shortcut: the checkout path is fixed to ~/t3code like the launchd job; set TRITIUM_FORK_REPO if it moves.
const REPO = process.env.TRITIUM_FORK_REPO ?? NodePath.join(HOME, "t3code");
const SYNC_SCRIPT = NodePath.join(REPO, "fork", "sync.sh");
const SYNC_LOG = NodePath.join(HOME, "Library", "Logs", "t3code-fork-sync.log");
const STAGED_APP = NodePath.join(HOME, "Library", "Caches", "t3code-fork", "Tritium.app");
const CHECK_INTERVAL = Duration.hours(1);
const MAX_NOTES = 30;

// Like the launchd job: sync.sh sets its own PATH and must not inherit the app's Electron variables.
const syncEnv = (): NodeJS.ProcessEnv => ({
  HOME,
  USER: process.env.USER,
  LOGNAME: process.env.LOGNAME,
  LANG: process.env.LANG ?? "en_US.UTF-8",
  TMPDIR: process.env.TMPDIR,
  PATH: "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
  ...(process.env.SSH_AUTH_SOCK ? { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK } : {}),
});

class ForkUpdateCommandError extends Schema.TaggedError<ForkUpdateCommandError>()(
  "ForkUpdateCommandError",
  { command: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

const run = (file: string, args: ReadonlyArray<string>) =>
  Effect.callback<string, ForkUpdateCommandError>((resume) => {
    const child = NodeChildProcess.execFile(
      file,
      [...args],
      { env: syncEnv(), maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) =>
        resume(
          error
            ? Effect.fail(
                new ForkUpdateCommandError({
                  command: [file, ...args].join(" "),
                  detail: stderr.trim().split("\n").at(-1) || error.message,
                }),
              )
            : Effect.succeed(stdout.trim()),
        ),
    );
    return Effect.sync(() => child.kill());
  });

const git = (...args: ReadonlyArray<string>) => run("/usr/bin/git", ["-C", REPO, ...args]);

const stagedVersion = Effect.suspend(() =>
  NodeFS.existsSync(STAGED_APP)
    ? run("/usr/bin/defaults", [
        "read",
        NodePath.join(STAGED_APP, "Contents", "Info.plist"),
        "CFBundleShortVersionString",
      ]).pipe(Effect.option)
    : Effect.succeed(Option.none<string>()),
);

/** The last message sync.sh logged, such as "Merge conflict with upstream: resolve it in …". */
const lastSyncMessage = (): string | null => {
  try {
    const lines = NodeFS.readFileSync(SYNC_LOG, "utf8").trimEnd().split("\n").slice(-400);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const match = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d (.+)$/.exec(lines[index]!);
      if (match) return match[1]!;
    }
  } catch {}
  return null;
};

type Upstream =
  | { readonly kind: "current" }
  | {
      readonly kind: "behind";
      readonly version: string;
      readonly notes: ReadonlyArray<DesktopUpdateReleaseNote>;
    };

/** Fetches upstream and names the build a sync would produce, with upstream's commits as notes. */
const inspectUpstream: Effect.Effect<Upstream, ForkUpdateCommandError> = Effect.gen(function* () {
  yield* git("fetch", "-q", "upstream", "main");
  const behind = Number(yield* git("rev-list", "--count", "HEAD..upstream/main"));
  if (behind === 0) return { kind: "current" } as const;
  const ownCommits = Number(yield* git("rev-list", "--count", "HEAD"));
  const upstreamPackage = yield* git("show", "upstream/main:apps/desktop/package.json");
  const upstreamVersion = /"version":\s*"([^"]+)"/.exec(upstreamPackage)?.[1] ?? "upstream";
  // sync.sh versions a build by its commit count, and the merge adds one commit.
  const version = `${upstreamVersion}-fork.${ownCommits + behind + 1}`;
  const subjects = (yield* git("log", "--no-merges", "--format=%s", "HEAD..upstream/main"))
    .split("\n")
    .filter((line) => line.length > 0);
  return {
    kind: "behind",
    version,
    notes: [
      {
        version,
        items: subjects.slice(0, MAX_NOTES),
        totalItems: subjects.length,
        intro: `Merges ${subjects.length} upstream changes into your fork.`,
      },
    ],
  } as const;
});

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const electronApp = yield* ElectronApp.ElectronApp;

  const stateRef = yield* Ref.make<DesktopUpdateState>({
    ...createInitialDesktopUpdateState(
      environment.appVersion,
      environment.runtimeInfo,
      environment.defaultDesktopSettings.updateChannel,
    ),
    enabled: environment.isPackaged,
    status: environment.isPackaged ? "idle" : "disabled",
    message: environment.isPackaged ? null : "Fork updates run only in the installed app.",
  });
  const changes = yield* PubSub.sliding<DesktopUpdateState>(16);
  const activeRef = yield* Ref.make<Option.Option<"check" | "download" | "install">>(Option.none());

  const emitState = Ref.get(stateRef).pipe(
    Effect.flatMap((state) => electronWindow.sendAll(IpcChannels.UPDATE_STATE_CHANNEL, state)),
  );
  const update = (f: (state: DesktopUpdateState) => DesktopUpdateState) =>
    Ref.updateAndGet(stateRef, f).pipe(
      Effect.tap((state) => PubSub.publish(changes, state)),
      Effect.tap(() => emitState),
    );
  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  /** Runs one action at a time; a second request while one runs is refused. */
  const exclusive = <A>(
    action: "check" | "download" | "install",
    effect: Effect.Effect<A>,
    refused: Effect.Effect<A>,
  ): Effect.Effect<A> =>
    Ref.modify(activeRef, (active) =>
      Option.isSome(active) ? [false, active] : [true, Option.some(action)],
    ).pipe(
      Effect.flatMap((admitted) =>
        admitted ? effect.pipe(Effect.ensuring(Ref.set(activeRef, Option.none()))) : refused,
      ),
    );

  const check = Effect.fn("ForkUpdates.check")(function* (reason: string) {
    yield* Effect.annotateCurrentSpan({ reason });
    return yield* exclusive<DesktopUpdateCheckResult>(
      "check",
      Effect.gen(function* () {
        if (!environment.isPackaged) return { checked: false, state: yield* Ref.get(stateRef) };
        const checkedAt = yield* nowIso;
        yield* update((state) => reduceDesktopUpdateStateOnCheckStart(state, checkedAt));
        const staged = yield* stagedVersion;
        if (Option.isSome(staged)) {
          const state = yield* update((current) =>
            reduceDesktopUpdateStateOnDownloadComplete(current, staged.value),
          );
          return { checked: true, state };
        }
        const upstream = yield* inspectUpstream.pipe(Effect.result);
        const state = yield* update((current) => {
          if (upstream._tag === "Failure") {
            return reduceDesktopUpdateStateOnCheckFailure(
              current,
              upstream.failure.message,
              checkedAt,
            );
          }
          return upstream.success.kind === "current"
            ? reduceDesktopUpdateStateOnNoUpdate(current, checkedAt)
            : reduceDesktopUpdateStateOnUpdateAvailable(
                current,
                upstream.success.version,
                checkedAt,
                upstream.success.notes,
              );
        });
        return { checked: true, state };
      }),
      Ref.get(stateRef).pipe(Effect.map((state) => ({ checked: false, state }))),
    );
  });

  const download = exclusive<DesktopUpdateActionResult>(
    "download",
    Effect.gen(function* () {
      yield* update(reduceDesktopUpdateStateOnDownloadStart);
      const synced = yield* run("/bin/zsh", [
        "-c",
        'exec /bin/zsh "$0" --from-app >>"$1" 2>&1',
        SYNC_SCRIPT,
        SYNC_LOG,
      ]).pipe(Effect.result);
      const staged = yield* stagedVersion;
      const checkedAt = yield* nowIso;
      const state = yield* update((current) => {
        if (Option.isSome(staged)) {
          return reduceDesktopUpdateStateOnDownloadComplete(current, staged.value);
        }
        const message = lastSyncMessage();
        if (synced._tag === "Success" && message === "Up to date with upstream") {
          return reduceDesktopUpdateStateOnNoUpdate(current, checkedAt);
        }
        return reduceDesktopUpdateStateOnDownloadFailure(
          current,
          message ?? "The fork build failed. See ~/Library/Logs/t3code-fork-sync.log.",
        );
      });
      return { accepted: true, completed: Option.isSome(staged), state };
    }),
    Ref.get(stateRef).pipe(Effect.map((state) => ({ accepted: false, completed: false, state }))),
  );

  const install = exclusive<DesktopUpdateActionResult>(
    "install",
    Effect.gen(function* () {
      if (Option.isNone(yield* stagedVersion)) {
        return { accepted: false, completed: false, state: yield* Ref.get(stateRef) };
      }
      // Detached so it outlives this app: it waits for the quit, swaps in the build and reopens it.
      yield* Effect.sync(() => {
        const log = NodeFS.openSync(SYNC_LOG, "a");
        const child = NodeChildProcess.spawn("/bin/zsh", [SYNC_SCRIPT, "--install-staged"], {
          detached: true,
          env: syncEnv(),
          stdio: ["ignore", log, log],
        });
        child.unref();
        NodeFS.closeSync(log);
      });
      yield* electronApp.quit;
      return { accepted: true, completed: false, state: yield* Ref.get(stateRef) };
    }),
    Ref.get(stateRef).pipe(Effect.map((state) => ({ accepted: false, completed: false, state }))),
  );

  return DesktopUpdates.of({
    getState: Ref.get(stateRef),
    isActionActive: Ref.get(activeRef).pipe(Effect.map(Option.isSome)),
    isInstallActive: Ref.get(activeRef).pipe(
      Effect.map((active) => Option.isSome(active) && active.value === "install"),
    ),
    subscribe: Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(changes);
      return { latest: yield* Ref.get(stateRef), changes: Stream.fromSubscription(subscription) };
    }),
    emitState,
    disabledReason: Ref.get(stateRef).pipe(
      Effect.map((state) => (state.enabled ? Option.none() : Option.fromNullOr(state.message))),
    ),
    configure: Effect.gen(function* () {
      if (!environment.isPackaged) return;
      yield* check("startup").pipe(
        Effect.delay(Duration.seconds(15)),
        Effect.repeat(Schedule.spaced(CHECK_INTERVAL)),
        Effect.forkScoped,
      );
    }),
    // Fork builds follow upstream main; the channel is kept only so settings render.
    setChannel: Effect.fn("ForkUpdates.setChannel")(function* (channel) {
      return yield* update((state) => ({ ...state, channel }));
    }),
    check,
    download,
    install,
    installPrepared: Effect.fn("ForkUpdates.installPrepared")(function* () {
      return { ...(yield* install), failed: false };
    }),
  });
});

export const layer = Layer.effect(DesktopUpdates, make);
