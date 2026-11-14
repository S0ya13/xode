import type { ThreadStructure } from "@t3tools/client-runtime/state/models";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveLastTurnStats,
  deriveSubagentRows,
  deriveThreadTotals,
  unionDurationMs,
} from "./threadDetailsStats.logic";

const T0 = Date.parse("2026-11-14T10:00:00.000Z");
const at = (seconds: number) => DateTime.makeUnsafe(T0 + seconds * 1_000);

const run = (id: string, ordinal: number, start: number, end: number | null) => ({
  id,
  ordinal,
  status: end === null ? "running" : "completed",
  providerInstanceId: "claude",
  activeAttemptId: `${id}-attempt`,
  requestedAt: at(start),
  startedAt: at(start),
  completedAt: end === null ? null : at(end),
});

const item = (
  type: string,
  runId: string,
  start: number,
  end: number | null,
  extra: object = {},
) => ({ type, runId, startedAt: at(start), completedAt: end === null ? null : at(end), ...extra });

function projection(input: {
  runs: ReadonlyArray<ReturnType<typeof run>>;
  items?: ReadonlyArray<object>;
  usage?: Record<string, object>;
  subagents?: ReadonlyArray<object>;
}): ThreadStructure {
  return {
    thread: { providerInstanceId: "claude" },
    providerSessions: [],
    messages: [],
    runs: input.runs,
    attempts: input.runs.map((entry) => ({ id: `${entry.id}-attempt`, runId: entry.id })),
    providerTurns: Object.entries(input.usage ?? {}).map(([runId, turnTokenUsage], index) => ({
      id: `turn-${index}`,
      ordinal: index + 1,
      status: "completed",
      runAttemptId: `${runId}-attempt`,
      turnTokenUsage,
    })),
    turnItems: input.items ?? [],
    subagents: input.subagents ?? [],
  } as unknown as ThreadStructure;
}

describe("unionDurationMs", () => {
  it("counts overlapping spans once", () => {
    expect(
      unionDurationMs([
        [0, 10],
        [5, 15],
        [20, 25],
        [30, 30],
      ]),
    ).toBe(20);
  });
});

describe("deriveLastTurnStats", () => {
  it("splits a finished turn into model and tool time and reads its tokens", () => {
    const stats = deriveLastTurnStats(
      projection({
        runs: [run("r1", 1, 0, 60)],
        items: [
          item("reasoning", "r1", 2, 4),
          item("command_execution", "r1", 10, 30),
          item("file_change", "r1", 20, 40),
          item("dynamic_tool", "r1", 45, 50, { deferredWork: { itemCount: 3 } }),
          item("assistant_message", "r1", 52, 60),
        ],
        usage: {
          r1: {
            usageScope: "main_agent",
            usageStatus: "complete",
            hasSubagents: false,
            inputTokens: 1_000,
            cachedInputTokens: 900,
            outputTokens: 600,
          },
        },
      }),
      T0 + 999_000,
    );
    expect(stats).toMatchObject({
      running: false,
      elapsedMs: 60_000,
      toolMs: 35_000,
      modelMs: 25_000,
      steps: 5,
      firstTokenMs: 2_000,
      // 600 output tokens over 23s of model time after the first token.
      tokensPerSecond: 26,
      cacheHitPercent: 90,
    });
  });

  it("measures a running turn up to now, including a tool still running", () => {
    const stats = deriveLastTurnStats(
      projection({
        runs: [run("r1", 1, 0, 20), run("r2", 2, 100, null)],
        items: [item("command_execution", "r2", 110, null)],
      }),
      T0 + 130_000,
    );
    expect(stats).toMatchObject({
      running: true,
      elapsedMs: 30_000,
      toolMs: 20_000,
      steps: 1,
      tokens: null,
      tokensPerSecond: null,
    });
  });
});

describe("deriveThreadTotals", () => {
  it("sums work time and tokens across started turns, noting partial usage", () => {
    const totals = deriveThreadTotals(
      projection({
        runs: [run("r1", 1, 0, 60), run("r2", 2, 100, 130)],
        usage: {
          r1: {
            usageScope: "main_agent",
            usageStatus: "complete",
            hasSubagents: true,
            inputTokens: 1_000,
            outputTokens: 100,
            otherUsage: { inputTokens: 400, outputTokens: 50 },
          },
          r2: {
            usageScope: "main_agent",
            usageStatus: "partial",
            hasSubagents: false,
            outputTokens: 20,
          },
        },
      }),
      T0,
    );
    expect(totals).toEqual({
      turns: 2,
      workMs: 90_000,
      tokens: { input: 1_000, output: 120, cached: 0, other: 450, complete: false },
    });
  });
});

describe("deriveSubagentRows", () => {
  it("puts running subagents first, then the most recent", () => {
    const agent = (id: string, status: string, start: number) => ({
      id,
      status,
      title: null,
      prompt: `${id} task\nmore detail`,
      model: null,
      startedAt: at(start),
      completedAt: null,
      childThreadId: null,
    });
    const rows = deriveSubagentRows(
      projection({
        runs: [],
        subagents: [
          agent("old", "completed", 0),
          agent("live", "running", 5),
          agent("new", "failed", 10),
        ],
      }),
    );
    expect(rows.map((row) => [row.title, row.running])).toEqual([
      ["live task", true],
      ["new task", false],
      ["old task", false],
    ]);
  });
});
