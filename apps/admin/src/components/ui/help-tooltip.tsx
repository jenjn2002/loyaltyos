import { ui } from "@/lib/ui-text";
import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type HelpTooltipProps = {
  children: ReactNode;
  label?: string;
  className?: string;
};

export function HelpTooltip({
  children,
  label = ui("Show definition"),
  className,
}: HelpTooltipProps): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs leading-relaxed">{children}</TooltipContent>
    </Tooltip>
  );
}

export function HelpTooltipProvider({ children }: { children: ReactNode }): JSX.Element {
  return <TooltipProvider delayDuration={150}>{children}</TooltipProvider>;
}
