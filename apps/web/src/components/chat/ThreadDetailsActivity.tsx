// Fork: context, turn and thread stats, and subagents for the Thread details card.
import type { ScopedThreadRef } from "@t3tools/contracts";
import { secondTick } from "@t3tools/client-runtime/clock";
import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import type { ThreadStructure } from "@t3tools/client-runtime/state/models";
import { deriveLatestThreadRun } from "@t3tools/client-runtime/state/thread-execution";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { useNavigate } from "@tanstack/react-router";
import { useSyncExternalStore, type ReactNode } from "react";

import { formatContextWindowTokens } from "../../lib/contextWindow";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { useQuietThreadProjection } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import {
  deriveLastTurnStats,
  deriveSubagentRows,
  deriveThreadTotals,
  type SubagentRow,
} from "./threadDetailsStats.logic";

const MAX_SUBAGENT_ROWS = 5;
const noSubscription = () => () => {};

/** The current second while `live`, so only a running section re-renders each tick. */
function useNow(live: boolean): number {
  return useSyncExternalStore(
    live ? secondTick.subscribe : noSubscription,
    secondTick.getSnapshot,
    secondTick.getSnapshot,
  );
}

const tokens = (value: number) => formatContextWindowTokens(value);

function StatRow({ label, children }: { readonly label: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="flex h-6 items-center justify-between gap-3 px-2.5 text-xs">
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <span className="shrink-0 tabular-nums">{children}</span>
    </div>
  );
}

function Heading({ title, aside }: { readonly title: string; readonly aside?: ReactNode }) {
  return (
    <div className="flex h-7 items-center justify-between gap-2 px-2.5 text-xs">
      <span className="font-medium">{title}</span>
      {aside ? <span className="min-w-0 truncate text-muted-foreground">{aside}</span> : null}
    </div>
  );
}

export interface ThreadDetailsCompact {
  readonly onCompact: () => void;
  readonly disabled: boolean;
}

/** Runs the same /compact as the composer, and is off while that would be refused. */
function CompactButton({ compact }: { readonly compact: ThreadDetailsCompact | undefined }) {
  if (!compact) return null;
  return (
    <Button
      type="button"
      size="xs"
      variant="ghost-muted"
      className="-my-1 -mr-1.5"
      disabled={compact.disabled}
      title={
        compact.disabled
          ? "Compact is available when the agent is idle and the thread has a conversation"
          : "Summarize the conversation to free context"
      }
      onClick={compact.onCompact}
    >
      Compact
    </Button>
  );
}

/** Context use at a glance: the share used, the window size, and the auto-compaction mark. */
export function ThreadDetailsContextSummary({
  usage,
  compact,
}: {
  readonly usage: ContextWindowSnapshot | null;
  readonly compact?: ThreadDetailsCompact | undefined;
}) {
  // Some providers never report context, and none have before the first reply.
  if (usage === null) {
    return (
      <ThreadDetailsSection
        headingId="thread-details-context-summary-heading"
        title="Context"
        showHeading={false}
      >
        <div className="flex h-7 items-center justify-between gap-2 px-2.5 text-xs">
          <span className="font-medium">Context</span>
          <span className="flex items-center gap-2 text-muted-foreground">
            Not reported yet
            <CompactButton compact={compact} />
          </span>
        </div>
      </ThreadDetailsSection>
    );
  }
  const maxTokens = usage.maxTokens != null && usage.maxTokens > 0 ? usage.maxTokens : null;
  const used =
    maxTokens !== null && usage.usedPercentage !== null
      ? Math.round(Math.max(0, Math.min(100, usage.usedPercentage)))
      : null;
  const threshold = usage.autoCompactThreshold ?? null;
  const tick =
    maxTokens !== null && threshold !== null && threshold > 0 && threshold < maxTokens
      ? (threshold / maxTokens) * 100
      : null;
  const breakdown = [
    usage.inputTokens != null ? `in ${tokens(usage.inputTokens)}` : null,
    usage.cachedInputTokens != null ? `cache ${tokens(usage.cachedInputTokens)}` : null,
    usage.outputTokens != null ? `out ${tokens(usage.outputTokens)}` : null,
  ].filter((part) => part !== null);
  return (
    <ThreadDetailsSection
      headingId="thread-details-context-summary-heading"
      title="Context"
      showHeading={false}
    >
      <div className="flex flex-col gap-1.5 px-2.5 pt-1 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">Context</span>
          <span className="flex items-center gap-2 text-muted-foreground tabular-nums">
            {tokens(usage.usedTokens)}
            {maxTokens !== null ? ` / ${tokens(maxTokens)}` : ""}
            <CompactButton compact={compact} />
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "text-xl leading-none font-semibold tracking-tight tabular-nums",
              used !== null && used >= 90
                ? "text-error"
                : used !== null && used >= 80 && "text-warning",
            )}
          >
            {used !== null ? `${used}%` : tokens(usage.usedTokens)}
          </span>
          {tick !== null ? (
            <span className="text-muted-foreground">auto-compacts at {Math.round(tick)}%</span>
          ) : null}
        </div>
        <div
          className="relative h-1.5 rounded-full bg-muted-foreground/20"
          role="meter"
          aria-label="Context used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={used ?? 0}
        >
          {used !== null && used > 0 ? (
            <span
              className={cn(
                "absolute inset-y-0 left-0 rounded-full",
                used >= 90 ? "bg-error" : used >= 80 ? "bg-warning" : "bg-foreground/80",
              )}
              style={{ width: `max(${used}%, 6px)` }}
            />
          ) : null}
          {tick !== null ? (
            <span
              aria-hidden
              className="absolute -top-[3px] h-3 w-0.5 -translate-x-1/2 rounded-full bg-warning"
              style={{ left: `${tick}%` }}
            />
          ) : null}
        </div>
        {breakdown.length > 0 ? (
          <div className="flex flex-wrap gap-x-3 text-muted-foreground tabular-nums">
            {breakdown.map((part) => (
              <span key={part}>{part}</span>
            ))}
          </div>
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}

function LastTurnSection({ projection }: { readonly projection: ThreadStructure }) {
  const latest = deriveLatestThreadRun(projection);
  const nowMs = useNow(latest?.startedAt != null && latest.completedAt === null);
  const stats = deriveLastTurnStats(projection, nowMs);
  if (stats === null) return null;
  const modelShare = stats.elapsedMs > 0 ? (stats.modelMs / stats.elapsedMs) * 100 : 0;
  const output =
    stats.tokens && stats.tokens.output > 0
      ? `${tokens(stats.tokens.output)}${stats.tokensPerSecond !== null ? ` · ~${stats.tokensPerSecond} tok/s` : ""}`
      : null;
  return (
    <ThreadDetailsSection
      headingId="thread-details-turn-heading"
      title="Last turn"
      showHeading={false}
    >
      <div className="flex flex-col">
        <Heading
          title="Last turn"
          aside={
            stats.running ? (
              <span className="inline-flex items-center gap-1.5 text-success">
                <span className="size-1.5 animate-pulse rounded-full bg-success motion-reduce:animate-none" />
                Working · {formatDuration(stats.elapsedMs)}
              </span>
            ) : (
              `Worked ${formatDuration(stats.elapsedMs)}`
            )
          }
        />
        {stats.elapsedMs > 0 ? (
          <div className="mx-2.5 my-1 flex h-1.5 overflow-hidden rounded-full bg-muted-foreground/20">
            <span className="bg-info" style={{ width: `${modelShare}%` }} />
            <span className="bg-muted-foreground/60" style={{ width: `${100 - modelShare}%` }} />
          </div>
        ) : null}
        <StatRow
          label={
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-info" />
              Model
            </span>
          }
        >
          {formatDuration(stats.modelMs)}
        </StatRow>
        <StatRow
          label={
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-muted-foreground/60" />
              Tools
            </span>
          }
        >
          {formatDuration(stats.toolMs)}
        </StatRow>
        <StatRow label="Steps">
          {stats.steps} tool {stats.steps === 1 ? "call" : "calls"}
        </StatRow>
        {output !== null ? <StatRow label="Output">{output}</StatRow> : null}
        {stats.firstTokenMs !== null ? (
          <StatRow label="First token">{formatDuration(stats.firstTokenMs)}</StatRow>
        ) : null}
        {stats.cacheHitPercent !== null ? (
          <StatRow label="Cache hit">
            <span className={cn(stats.cacheHitPercent >= 80 && "text-success")}>
              {stats.cacheHitPercent}%
            </span>
          </StatRow>
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}

function ThreadTotalsSection({ projection }: { readonly projection: ThreadStructure }) {
  const live = projection.runs.some((run) => run.startedAt !== null && run.completedAt === null);
  const totals = deriveThreadTotals(projection, useNow(live));
  if (totals.turns === 0) return null;
  return (
    <ThreadDetailsSection
      headingId="thread-details-totals-heading"
      title="This thread"
      showHeading={false}
    >
      <div className="flex flex-col">
        <Heading
          title="This thread"
          aside={`${totals.turns} ${totals.turns === 1 ? "turn" : "turns"}`}
        />
        <StatRow label="Work time">{formatDuration(totals.workMs)}</StatRow>
        {totals.tokens && totals.tokens.input + totals.tokens.output > 0 ? (
          <StatRow label="Tokens">
            {tokens(totals.tokens.input)} ↑ · {tokens(totals.tokens.output)} ↓
          </StatRow>
        ) : null}
        {totals.tokens && totals.tokens.other > 0 ? (
          <StatRow label="Subagent tokens">{tokens(totals.tokens.other)}</StatRow>
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}

const STATUS_DOT: Record<SubagentRow["status"], string> = {
  idle: "bg-muted-foreground/50",
  pending: "bg-success",
  running: "bg-success animate-pulse motion-reduce:animate-none",
  waiting: "bg-warning",
  completed: "bg-muted-foreground/50",
  failed: "bg-error",
  cancelled: "bg-muted-foreground/30",
  interrupted: "bg-warning",
};

function SubagentElapsed({ row }: { readonly row: SubagentRow }) {
  const nowMs = useNow(row.running);
  if (row.startedAt === null) return null;
  const end = row.running ? nowMs : row.completedAt === null ? null : Date.parse(row.completedAt);
  if (end === null) return null;
  return <>{formatDuration(Math.max(0, end - Date.parse(row.startedAt)))}</>;
}

function SubagentsSection({
  threadRef,
  projection,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly projection: ThreadStructure;
}) {
  const navigate = useNavigate();
  const rows = deriveSubagentRows(projection);
  if (rows.length === 0) return null;
  const running = rows.filter((row) => row.running).length;
  const shown = rows.slice(0, MAX_SUBAGENT_ROWS);
  return (
    <ThreadDetailsSection
      headingId="thread-details-subagents-heading"
      title="Subagents"
      showHeading={false}
    >
      <div className="flex flex-col">
        <Heading
          title="Subagents"
          aside={[running > 0 ? `${running} running` : null, `${rows.length - running} done`]
            .filter(Boolean)
            .join(" · ")}
        />
        {shown.map((row) => {
          const meta = [
            row.model,
            row.toolCalls !== null ? `${row.toolCalls} tool calls` : null,
            row.totalTokens !== null ? `${tokens(row.totalTokens)} tokens` : null,
            row.status === "failed" || row.status === "cancelled" || row.status === "interrupted"
              ? row.status
              : null,
          ].filter(Boolean);
          const childThreadId = row.childThreadId;
          const body = (
            <>
              <span
                className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", STATUS_DOT[row.status])}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{row.title}</span>
                {meta.length > 0 ? (
                  <span className="truncate text-2xs text-muted-foreground">
                    {meta.join(" · ")}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                <SubagentElapsed row={row} />
              </span>
            </>
          );
          const className =
            "flex w-full items-start gap-2 rounded-lg px-2.5 py-1 text-left text-xs outline-none";
          return childThreadId !== null ? (
            <button
              key={row.id}
              type="button"
              className={cn(
                className,
                "hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset dark:hover:bg-white/[0.08]",
              )}
              onClick={() =>
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: buildThreadRouteParams({
                    environmentId: threadRef.environmentId,
                    threadId: childThreadId,
                  }),
                })
              }
            >
              {body}
            </button>
          ) : (
            <div key={row.id} className={className}>
              {body}
            </div>
          );
        })}
        {rows.length > shown.length ? (
          <span className="px-2.5 pt-1 text-2xs text-muted-foreground">
            {rows.length - shown.length} more in the timeline
          </span>
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}

export function ThreadDetailsActivity({
  threadRef,
  show,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly show: { readonly turn: boolean; readonly totals: boolean; readonly subagents: boolean };
}) {
  const projection = useQuietThreadProjection(threadRef)?.projection ?? null;
  if (projection === null) return null;
  return (
    <>
      {show.turn ? <LastTurnSection projection={projection} /> : null}
      {show.totals ? <ThreadTotalsSection projection={projection} /> : null}
      {show.subagents ? <SubagentsSection threadRef={threadRef} projection={projection} /> : null}
    </>
  );
}
