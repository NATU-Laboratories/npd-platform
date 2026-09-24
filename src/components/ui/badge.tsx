import * as React from "react";
import { cn } from "@/lib/utils";
import { FIRST_RUNNING_PHASE, STATUS_COLOR, statusLabel, VALIDATION_COLOR } from "@/lib/labels";
import type { ProjectStatus } from "@/db/schema";

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", className)} {...props} />;
}

export function StatusBadge({ status, phase, className }: { status: ProjectStatus; phase?: number | null; className?: string }) {
  const validating = status === "in_progress" && phase != null && phase < FIRST_RUNNING_PHASE;
  return <Badge className={cn(validating ? VALIDATION_COLOR : STATUS_COLOR[status], className)}>{statusLabel(status, phase)}</Badge>;
}

export function DeptChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white px-2 py-0.5 text-xs text-slate-700 ring-1 ring-slate-200">
      <span className="size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      {name}
    </span>
  );
}
