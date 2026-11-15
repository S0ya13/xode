import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";

import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ComposerControl } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { ThreadDetailsContextSummary, type ThreadDetailsCompact } from "./ThreadDetailsActivity";

const RING_RADIUS = 6;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** Fork: the composer's context ring. It opens the context summary with its Compact button. */
export function ComposerContextMeter({
  usage,
  compact,
}: {
  readonly usage: ContextWindowSnapshot | null;
  readonly compact: ThreadDetailsCompact | undefined;
}) {
  const composerMenuProps = useComposerMenuProps();
  const percent =
    usage?.usedPercentage != null && usage.maxTokens != null && usage.maxTokens > 0
      ? Math.round(Math.max(0, Math.min(100, usage.usedPercentage)))
      : null;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <ComposerControl
            data-composer-context-meter
            aria-label={percent === null ? "Context" : `Context ${percent}% used`}
            className="tabular-nums"
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
          <span data-composer-control-label className="text-xs">
            {percent}%
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverPopup {...composerMenuProps} side="top" align="end" padding="compact" width="sm">
        <ThreadDetailsContextSummary usage={usage} compact={compact} />
      </PopoverPopup>
    </Popover>
  );
}
