import { OpenAI } from "../Icons";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { SidebarUsageLimitWindow, SidebarUsageLimitsView } from "../Sidebar.logic";

function UsageLimitMeter({ window }: { window: SidebarUsageLimitWindow }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="w-9 shrink-0 text-[10px] font-medium text-muted-foreground/80">
        {window.label}
      </span>
      <div className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-muted-foreground/12">
        <div
          className="h-full rounded-full bg-foreground/65 transition-[width] duration-300"
          style={{ width: `${window.percent}%` }}
        />
      </div>
      <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground/80">
        {window.percent}%
      </span>
    </div>
  );
}

export function SidebarUsageLimitsPill({ usageLimits }: { usageLimits: SidebarUsageLimitsView }) {
  const description = `Codex usage remaining: ${usageLimits.weekly.percent}% weekly, ${usageLimits.fiveHour.percent}% 5 hour.`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            aria-label={description}
            className="flex min-h-8 w-full items-center gap-2 rounded-lg border border-border/70 bg-muted/25 px-2 py-1.5 text-xs text-muted-foreground"
          >
            <OpenAI className="size-3.5 shrink-0 text-foreground/80" />
            <span className="shrink-0 text-[11px] font-medium text-foreground/80">
              Usage Limits
            </span>
            <div className="h-4 w-px shrink-0 bg-border" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <UsageLimitMeter window={usageLimits.weekly} />
              <UsageLimitMeter window={usageLimits.fiveHour} />
            </div>
          </div>
        }
      />
      <TooltipPopup side="top">{description}</TooltipPopup>
    </Tooltip>
  );
}
