import { RefreshCwIcon } from "lucide-react";

import { OpenAI } from "../Icons";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { SidebarUsageLimitWindow, SidebarUsageLimitsView } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

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

export function SidebarUsageLimitsPill({
  usageLimits,
  className,
  onRefresh,
  refreshing = false,
  refreshError = null,
}: {
  usageLimits: SidebarUsageLimitsView | null;
  className?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  refreshError?: string | null;
}) {
  const updatedSuffix = usageLimits?.updatedAt
    ? ` Updated ${new Date(usageLimits.updatedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}.`
    : "";
  const errorSuffix = refreshError ? ` Refresh failed: ${refreshError}` : "";
  const description = usageLimits
    ? `Codex usage remaining: ${usageLimits.weekly.percent}% weekly, ${usageLimits.fiveHour.percent}% 5 hour.${updatedSuffix}${errorSuffix}`
    : `Codex usage has not been loaded yet.${errorSuffix}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            aria-label={description}
            className={cn(
              "flex min-h-8 w-full flex-col gap-2 rounded-lg border border-border/70 bg-muted/25 px-2 py-1.5 text-xs text-muted-foreground",
              className,
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-[11px] font-medium text-foreground/80">Usage Limits</span>
              <div className="h-px min-w-0 flex-1 bg-border" />
              {onRefresh ? (
                <Button
                  aria-label="Refresh Codex usage"
                  className="size-6 shrink-0 text-muted-foreground/80"
                  disabled={refreshing}
                  size="icon-sm"
                  variant="ghost"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onRefresh();
                  }}
                >
                  <RefreshCwIcon
                    aria-hidden="true"
                    className={cn("size-3.5", refreshing && "animate-spin")}
                  />
                </Button>
              ) : null}
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <OpenAI className="size-3.5 shrink-0 text-foreground/80" />
              {usageLimits ? (
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <UsageLimitMeter window={usageLimits.weekly} />
                  <UsageLimitMeter window={usageLimits.fiveHour} />
                </div>
              ) : (
                <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground/80">
                  Not loaded
                </span>
              )}
            </div>
          </div>
        }
      />
      <TooltipPopup side="top">{description}</TooltipPopup>
    </Tooltip>
  );
}
