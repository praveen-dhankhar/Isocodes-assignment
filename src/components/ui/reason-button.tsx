"use client";

import type { ComponentProps } from "react";
import { Button } from "./button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

/**
 * A button that can't act is disabled with a tooltip saying why (CLAUDE.md UI rule). A disabled button gets no pointer
 * events, so the tooltip hangs on a focusable wrapper.
 */
export function ReasonButton({ reason, disabled, ...props }: ComponentProps<typeof Button> & { reason: string | null }) {
  if (!reason) return <Button disabled={disabled} {...props} />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={reason}>
          <Button disabled {...props} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
