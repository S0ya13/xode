// @effect-diagnostics globalTimers:off -- The safety release must outlive the IPC call that started dictation.
// @effect-diagnostics nodeBuiltinImport:off -- Only the main process can run osascript to reach system audio.
/**
 * Fork: quiets the Mac while the user dictates, by pausing what plays or lowering the volume, and
 * restores it afterwards. MediaRemote answers Apple-signed callers only, so osascript reads and
 * controls Now Playing through it.
 */
import * as NodeChildProcess from "node:child_process";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { app } from "electron";

type SystemMediaAction = "lower" | "pause";

class SystemMediaError extends Schema.TaggedError<SystemMediaError>()("SystemMediaError", {
  cause: Schema.Defect(),
}) {}

const MEDIA_SCRIPT = `function run(argv) {
  ObjC.import("Foundation");
  $.NSBundle.bundleWithPath("/System/Library/PrivateFrameworks/MediaRemote.framework").load;
  const request = $.NSClassFromString("MRNowPlayingRequest");
  ObjC.bindFunction("MRMediaRemoteSendCommand", ["bool", ["int", "id"]]);
  // The command is dropped when osascript exits before MediaRemote delivers it.
  if (argv[0] === "play") {
    $.MRMediaRemoteSendCommand(0, $());
    delay(0.4);
    return "played";
  }
  if (request.isNil() || !request.localIsPlaying) return "idle";
  $.MRMediaRemoteSendCommand(1, $());
  delay(0.4);
  return "paused";
}`;

// Dictation stops at five minutes; this catches a window that closed mid-recording.
const SAFETY_RELEASE_MS = 6 * 60_000;
/** Lowered volume as a share of the user's volume. */
const LOWERED_VOLUME_SHARE = 0.3;

type Held =
  | { readonly kind: "pause" }
  | { readonly kind: "lower"; readonly from: number; readonly to: number };

let held: Held | null = null;
let safetyTimer: ReturnType<typeof setTimeout> | undefined;

const osascript = (args: ReadonlyArray<string>) =>
  new Promise<string>((resolve, reject) => {
    NodeChildProcess.execFile(
      "/usr/bin/osascript",
      [...args],
      { timeout: 5_000 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout.trim());
      },
    );
  });

const readVolume = async () =>
  Number(await osascript(["-e", "output volume of (get volume settings)"]));
const setVolumeArgs = (volume: number) => ["-e", `set volume output volume ${Math.round(volume)}`];

/** What to restore, or null when there was nothing to quiet. */
async function quiet(action: SystemMediaAction): Promise<Held | null> {
  if (action === "pause") {
    const result = await osascript(["-l", "JavaScript", "-e", MEDIA_SCRIPT, "pause"]);
    return result === "paused" ? { kind: "pause" } : null;
  }
  const from = await readVolume();
  if (!Number.isFinite(from) || from <= 0) return null;
  const to = Math.round(from * LOWERED_VOLUME_SHARE);
  await osascript(setVolumeArgs(to));
  return { kind: "lower", from, to };
}

async function restore(state: Held): Promise<void> {
  if (state.kind === "pause") {
    await osascript(["-l", "JavaScript", "-e", MEDIA_SCRIPT, "play"]);
    return;
  }
  // A volume the user changed during dictation is theirs to keep.
  if ((await readVolume()) === state.to) await osascript(setVolumeArgs(state.from));
}

// Quitting mid-dictation must not leave the Mac quiet.
const restoreOnQuit = () => {
  const state = held;
  held = null;
  if (state?.kind === "lower") {
    try {
      NodeChildProcess.execFileSync("/usr/bin/osascript", setVolumeArgs(state.from), {
        timeout: 3_000,
      });
    } catch {
      // Best effort while quitting.
    }
  }
};

async function holdNow(action: SystemMediaAction) {
  if (held) return;
  const state = await quiet(action);
  if (!state) return;
  held = state;
  app.once("will-quit", restoreOnQuit);
  clearTimeout(safetyTimer);
  safetyTimer = setTimeout(
    () => void enqueue(releaseNow).catch(() => undefined),
    SAFETY_RELEASE_MS,
  );
}

async function releaseNow() {
  const state = held;
  if (!state) return;
  held = null;
  clearTimeout(safetyTimer);
  app.removeListener("will-quit", restoreOnQuit);
  await restore(state);
}

// Hold and release run one at a time, so a release sent while the pause is still starting waits for it.
let queue: Promise<void> = Promise.resolve();
const enqueue = (task: () => Promise<void>) => {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
};

export const hold = Effect.fn("ElectronSystemMedia.hold")(function* (action: SystemMediaAction) {
  if ((yield* HostProcess.Platform) !== "darwin") return;
  yield* Effect.tryPromise({
    try: () => enqueue(() => holdNow(action)),
    catch: (cause) => new SystemMediaError({ cause }),
  }).pipe(Effect.catch((cause) => Effect.logWarning("Could not quiet system media", cause)));
});

export const release = Effect.fn("ElectronSystemMedia.release")(function* () {
  if ((yield* HostProcess.Platform) !== "darwin") return;
  yield* Effect.tryPromise({
    try: () => enqueue(releaseNow),
    catch: (cause) => new SystemMediaError({ cause }),
  }).pipe(Effect.catch((cause) => Effect.logWarning("Could not restore system media", cause)));
});
