import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { formatContextWindowTokens } from "~/lib/contextWindow";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ComposerControl } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import type { ThreadDetailsCompact } from "./ThreadDetailsActivity";

const RING_RADIUS = 6;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

const tokens = (value: number) => formatContextWindowTokens(value).replace(/m$/, "M");

function MeterRow(props: {
  readonly label: string;
  readonly value: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex h-8 w-full cursor-pointer items-center justify-between gap-3 border-t border-border/70 px-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <span className="text-muted-foreground">{props.label}</span>
      <span className="flex min-w-0 items-center gap-1 text-foreground">
        <span className="truncate">{props.value}</span>
        <ChevronRightIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
      </span>
    </button>
  );
}

/**
 * Fork: the composer's context ring. It opens how full the context is, a Compact button, and the
 * model and access rows, which open the model picker.
 */
export function ComposerContextMeter(props: {
  readonly usage: ContextWindowSnapshot | null;
  readonly compact: ThreadDetailsCompact | undefined;
  readonly modelLabel: string;
  readonly accessLabel: string;
  readonly onOpenModelPicker: () => void;
}) {
  const { usage, compact } = props;
  const composerMenuProps = useComposerMenuProps();
  const [open, setOpen] = useState(false);
  const maxTokens = usage?.maxTokens != null && usage.maxTokens > 0 ? usage.maxTokens : null;
  const percent =
    maxTokens !== null && usage?.usedPercentage != null
      ? Math.round(Math.max(0, Math.min(100, usage.usedPercentage)))
      : null;
  const threshold = usage?.autoCompactThreshold ?? null;
  const tick =
    maxTokens !== null && threshold !== null && threshold > 0 && threshold < maxTokens
      ? (threshold / maxTokens) * 100
      : null;
  const cachedPercent =
    usage?.inputTokens != null && usage.inputTokens > 0 && usage.cachedInputTokens != null
      ? Math.round((usage.cachedInputTokens / usage.inputTokens) * 100)
      : null;
  const openModelPicker = () => {
    setOpen(false);
    props.onOpenModelPicker();
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <ComposerControl
            data-composer-context-meter
            aria-label={percent === null ? "Context" : `Context ${percent}% used`}
          />
        }
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 -rotate-90">
          <circle
            cx="8"
            cy="8"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="2"
            className="stroke-border"
          />
          {percent !== null && percent > 0 ? (
            <circle
              cx="8"
              cy="8"
              r={RING_RADIUS}
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={`${(percent / 100) * RING_LENGTH} ${RING_LENGTH}`}
              className="stroke-primary"
            />
          ) : null}
        </svg>
        {percent !== null && percent > 0 ? (
          <span data-composer-control-label className="text-xs tabular-nums">
            {percent}%
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverPopup {...composerMenuProps} side="top" align="end" padding="compact" width="sm">
        <div data-composer-context-summary className="grid gap-2 pt-1">
          {usage === null || percent === null ? (
            <div className="text-sm text-muted-foreground">
              Context is reported after the first reply.
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums">{percent}%</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {tokens(usage.usedTokens ?? 0)} / {tokens(maxTokens ?? 0)}
                </span>
              </div>
              <div className="relative h-1 rounded-full bg-muted">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-primary"
                  style={{ width: `${percent}%` }}
                />
                {tick !== null ? (
                  <div
                    aria-hidden="true"
                    className="absolute -top-1 h-3 w-px bg-muted-foreground/60"
                    style={{ left: `${tick}%` }}
                  />
                ) : null}
              </div>
              <div className="flex justify-between gap-3 text-xs text-muted-foreground tabular-nums">
                <span>{cachedPercent !== null ? `${cachedPercent}% cached` : ""}</span>
                <span>
                  {tick !== null && threshold !== null
                    ? `auto-compact at ${Math.round((threshold / (maxTokens ?? 1)) * 100)}%`
                    : usage.outputTokens != null
                      ? `last reply ${tokens(usage.outputTokens)} tok`
                      : ""}
                </span>
              </div>
            </>
          )}
          {compact ? (
            <Button
              variant="outline"
              size="sm"
              disabled={compact.disabled}
              onClick={() => {
                setOpen(false);
                compact.onCompact();
              }}
            >
              Compact
            </Button>
          ) : null}
          <div className="mt-1 grid">
            <MeterRow label="Model" value={props.modelLabel} onClick={openModelPicker} />
            <MeterRow label="Access" value={props.accessLabel} onClick={openModelPicker} />
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
