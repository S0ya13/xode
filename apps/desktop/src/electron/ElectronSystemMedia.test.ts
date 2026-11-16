import * as Effect from "effect/Effect";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile, execFileSync: vi.fn() }));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return { app: new EventEmitter() };
});

import { hold, release } from "./ElectronSystemMedia.ts";

// Answers osascript calls in order; each answer is the script's stdout.
const answer = (outputs: string[]) => {
  const calls: string[][] = [];
  execFile.mockReset().mockImplementation((_file, args: string[], _options, callback) => {
    calls.push(args);
    callback(null, `${outputs.shift() ?? ""}\n`, "");
  });
  return calls;
};

const onMac = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provideService(HostProcess.Platform, "darwin"));

it.effect("pauses what plays and resumes it afterwards", () =>
  onMac(
    Effect.gen(function* () {
      const calls = answer(["paused", "true"]);
      yield* hold("pause");
      yield* release();
      expect(calls.map((args) => args.at(-1))).toEqual(["pause", "play"]);
    }),
  ),
);

it.effect("does not start playback when nothing was playing", () =>
  onMac(
    Effect.gen(function* () {
      const calls = answer(["idle"]);
      yield* hold("pause");
      yield* release();
      expect(calls).toHaveLength(1);
    }),
  ),
);

it.effect("lowers the volume and restores it", () =>
  onMac(
    Effect.gen(function* () {
      const calls = answer(["80", "", "24", ""]);
      yield* hold("lower");
      yield* release();
      expect(calls.map((args) => args.at(-1))).toEqual([
        "output volume of (get volume settings)",
        "set volume output volume 24",
        "output volume of (get volume settings)",
        "set volume output volume 80",
      ]);
    }),
  ),
);

it.effect("keeps a volume the user changed while dictating", () =>
  onMac(
    Effect.gen(function* () {
      const calls = answer(["80", "", "55"]);
      yield* hold("lower");
      yield* release();
      expect(calls).toHaveLength(3);
    }),
  ),
);

it.effect("leaves other platforms alone", () =>
  Effect.gen(function* () {
    const calls = answer([]);
    yield* hold("pause");
    yield* release();
    expect(calls).toHaveLength(0);
  }).pipe(Effect.provideService(HostProcess.Platform, "linux")),
);
