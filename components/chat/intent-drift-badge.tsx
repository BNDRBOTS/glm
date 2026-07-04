"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface DistillationBadge {
  alignment: number;      // 0-1
  driftDetected: boolean;
  entityCount: number;
  factCount: number;
  decisionCount: number;
}

export function IntentDriftBadge({ state }: { state: DistillationBadge | null }) {
  const [expanded, setExpanded] = React.useState(false);

  if (!state) return null;

  const pct = Math.round(state.alignment * 100);
  const status =
    state.driftDetected ? "drift" :
    pct >= 70 ? "on-track" :
    pct >= 40 ? "watch" : "drift";

  const color =
    status === "on-track" ? "text-emerald-500" :
    status === "watch" ? "text-amber-500" :
    "text-red-500";

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-full glass px-2.5 text-[11px] font-medium press-smooth",
          color
        )}
        title="Intent alignment"
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", {
          "bg-emerald-500": status === "on-track",
          "bg-amber-500": status === "watch",
          "bg-red-500": status === "drift",
        })} />
        <span>{pct}% aligned</span>
        {state.driftDetected && (
          <span className="ml-0.5 rounded bg-red-500/15 px-1 text-[9px] uppercase tracking-wider">
            drift
          </span>
        )}
      </button>

      {expanded && (
        <div className="absolute right-0 top-9 z-50 w-64 glass-strong rounded-xl p-3 text-xs shadow-xl">
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Distillation (live)
          </div>
          <div className="space-y-1.5">
            <Stat label="Entities tracked" value={state.entityCount} />
            <Stat label="Facts extracted" value={state.factCount} />
            <Stat label="Decisions logged" value={state.decisionCount} />
          </div>
          <div className="mt-2 border-t border-border pt-2 text-[10px] text-muted-foreground">
            Intent is frozen from your first message. Drift is flagged, never silently re-summarized.
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  );
}
