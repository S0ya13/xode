import type { ThreadStructure } from "@t3tools/client-runtime/state/models";
import { deriveLatestThreadRun } from "@t3tools/client-runtime/state/thread-execution";
import { isOrchestrationV2WorkActive, orchestrationV2RunWorkStartedAt } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

type Run = ThreadStructure["runs"][number];
type Item = ThreadStructure["turnItems"][number];
type ProviderTurn = ThreadStructure["providerTurns"][number];
type Subagent = ThreadStructure["subagents"][number];

/** Items that are the agent acting rather than writing; their spans are tool time. */
const TOOL_ITEM_TYPES: ReadonlySet<Item["type"]> = new Set([
  "command_execution",
  "file_change",
  "file_search",
  "dynamic_tool",
  "web_search",
  "subagent",
]);

const MIN_RATED_OUTPUT_TOKENS = 20;

const ms = (value: DateTime.Utc | null | undefined) =>
  value == null ? null : DateTime.toEpochMillis(value);

export interface TurnTokens {
  readonly input: number;
  readonly output: number;
  readonly cached: number;
  readonly other: number;
  /** False when a provider turn reported partial or no usage, so totals undercount. */
  readonly complete: boolean;
}

export interface LastTurnStats {
  readonly running: boolean;
  /** Start of work, for the live timer. */
  readonly startedAtMs: number;
  readonly elapsedMs: number;
  readonly toolMs: number;
  readonly modelMs: number;
  readonly steps: number;
  readonly firstTokenMs: number | null;
  readonly tokens: TurnTokens | null;
  readonly tokensPerSecond: number | null;
  readonly cacheHitPercent: number | null;
}

export interface ThreadTotals {
  readonly turns: number;
  readonly workMs: number;
  readonly tokens: TurnTokens | null;
}

export interface SubagentRow {
  readonly id: string;
  readonly title: string;
  readonly status: Subagent["status"];
  readonly running: boolean;
  readonly model: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly totalTokens: number | null;
  readonly toolCalls: number | null;
  readonly childThreadId: Subagent["childThreadId"];
}

/** Total length of possibly overlapping spans, so parallel tool calls are not counted twice. */
export function unionDurationMs(spans: ReadonlyArray<readonly [number, number]>): number {
  const sorted = spans.filter(([start, end]) => end > start).toSorted((a, b) => a[0] - b[0]);
  let total = 0;
  let current: [number, number] | null = null;
  for (const [start, end] of sorted) {
    if (current === null || start > current[1]) {
      if (current !== null) total += current[1] - current[0];
      current = [start, end];
    } else if (end > current[1]) {
      current[1] = end;
    }
  }
  return current === null ? total : total + current[1] - current[0];
}

function runProviderTurns(projection: ThreadStructure, runIds: ReadonlySet<string>) {
  const attempts = new Set(
    projection.attempts.filter((attempt) => runIds.has(attempt.runId)).map((attempt) => attempt.id),
  );
  return projection.providerTurns.filter(
    (turn) => turn.runAttemptId !== null && attempts.has(turn.runAttemptId),
  );
}

function sumTurnTokens(turns: ReadonlyArray<ProviderTurn>): TurnTokens | null {
  let found = false;
  let complete = true;
  let input = 0;
  let output = 0;
  let cached = 0;
  let other = 0;
  for (const turn of turns) {
    const usage = turn.turnTokenUsage;
    if (usage === undefined || usage.localCommand) continue;
    found = true;
    if (usage.usageStatus !== "complete") complete = false;
    input += usage.inputTokens ?? 0;
    output += usage.outputTokens ?? 0;
    cached += usage.cachedInputTokens ?? 0;
    other += (usage.otherUsage?.inputTokens ?? 0) + (usage.otherUsage?.outputTokens ?? 0);
  }
  return found ? { input, output, cached, other, complete } : null;
}

function runWindow(run: Run, nowMs: number): readonly [number, number] | null {
  const start = ms(orchestrationV2RunWorkStartedAt(run));
  if (start === null || run.startedAt === null) return null;
  const end = ms(run.completedAt) ?? nowMs;
  return [start, Math.max(start, end)];
}

/**
 * The latest turn's timing and tokens. Model time is the turn's length minus tool time, so it
 * also holds waiting and streaming; tok/s divides output by that, which makes it an estimate.
 */
export function deriveLastTurnStats(
  projection: ThreadStructure,
  nowMs: number,
): LastTurnStats | null {
  const summary = deriveLatestThreadRun(projection);
  const run = summary && projection.runs.find((candidate) => candidate.id === summary.runId);
  if (!run) return null;
  const window = runWindow(run, nowMs);
  if (window === null) return null;
  const [startedAtMs, endMs] = window;
  const items = projection.turnItems.filter((item) => item.runId === run.id);
  const toolSpans: Array<readonly [number, number]> = [];
  let steps = 0;
  let firstOutputMs: number | null = null;
  for (const item of items) {
    const start = ms(item.startedAt);
    if (TOOL_ITEM_TYPES.has(item.type)) {
      // Collapsed work arrives as one item standing for several.
      steps += item.deferredWork?.itemCount ?? 1;
      if (start !== null) toolSpans.push([start, Math.min(ms(item.completedAt) ?? endMs, endMs)]);
    }
    if ((item.type === "assistant_message" || item.type === "reasoning") && start !== null) {
      firstOutputMs = firstOutputMs === null ? start : Math.min(firstOutputMs, start);
    }
  }
  const elapsedMs = endMs - startedAtMs;
  const toolMs = Math.min(elapsedMs, unionDurationMs(toolSpans));
  const modelMs = Math.max(0, elapsedMs - toolMs);
  const tokens = sumTurnTokens(runProviderTurns(projection, new Set([run.id])));
  const firstTokenMs = firstOutputMs === null ? null : Math.max(0, firstOutputMs - startedAtMs);
  // Generation speed: output over model time after the first token, so latency does not drag it
  // down. Tiny replies are mostly latency, so they get no rate.
  const generatingMs = modelMs - (firstTokenMs ?? 0);
  return {
    running: run.completedAt === null,
    startedAtMs,
    elapsedMs,
    toolMs,
    modelMs,
    steps,
    firstTokenMs,
    tokens,
    tokensPerSecond:
      tokens && tokens.output >= MIN_RATED_OUTPUT_TOKENS && generatingMs >= 1_000
        ? Math.round(tokens.output / (generatingMs / 1_000))
        : null,
    // Input includes cache reads, so the share of input served from cache.
    cacheHitPercent:
      tokens && tokens.input > 0 ? Math.round((tokens.cached / tokens.input) * 100) : null,
  };
}

export function deriveThreadTotals(projection: ThreadStructure, nowMs: number): ThreadTotals {
  const started = projection.runs.filter((run) => run.startedAt !== null);
  let workMs = 0;
  for (const run of started) {
    const window = runWindow(run, nowMs);
    if (window !== null) workMs += window[1] - window[0];
  }
  return {
    turns: started.length,
    workMs,
    tokens: sumTurnTokens(
      runProviderTurns(projection, new Set(started.map((run) => run.id as string))),
    ),
  };
}

/** Running first, then the most recent; finished ones keep their order by start. */
export function deriveSubagentRows(projection: ThreadStructure): SubagentRow[] {
  return projection.subagents
    .map((agent) => ({
      id: agent.id,
      title: (agent.title ?? agent.prompt.split("\n", 1)[0] ?? "").trim() || "Subagent",
      status: agent.status,
      running: isOrchestrationV2WorkActive(agent.status),
      model: agent.model,
      startedAt: agent.startedAt === null ? null : DateTime.formatIso(agent.startedAt),
      completedAt: agent.completedAt === null ? null : DateTime.formatIso(agent.completedAt),
      totalTokens: agent.workflow?.totalTokens ?? null,
      toolCalls: agent.workflow?.toolCalls ?? null,
      childThreadId: agent.childThreadId,
    }))
    .toSorted(
      (a, b) =>
        Number(b.running) - Number(a.running) ||
        (b.startedAt ?? "").localeCompare(a.startedAt ?? ""),
    );
}
