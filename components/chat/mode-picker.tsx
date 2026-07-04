"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { MODES, type ChatMode } from "@/lib/permissions/modes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";

export interface ModePickerProps {
  mode: ChatMode;
  fullBuildOnly: boolean;
  onModeChange: (m: ChatMode) => void;
  onFullBuildOnlyChange: (v: boolean) => void;
  disabled?: boolean;
}

export function ModePicker({
  mode,
  fullBuildOnly,
  onModeChange,
  onFullBuildOnlyChange,
  disabled,
}: ModePickerProps) {
  const active = MODES.find((m) => m.id === mode) ?? MODES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium text-muted-foreground hover:bg-foreground/5 hover:text-foreground press-smooth disabled:opacity-50"
        >
          <ModeIcon mode={mode} />
          <span>{active.label}</span>
          {fullBuildOnly && (
            <span className="ml-1 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-foreground">
              FBO
            </span>
          )}
          <ChevronDownIcon />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Execution Mode
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {MODES.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onClick={() => onModeChange(m.id)}
            className="flex flex-col items-start gap-1 py-2"
          >
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center gap-2">
                <ModeIcon mode={m.id} />
                <span className="font-medium">{m.label}</span>
              </div>
              {m.id === mode && <CheckIcon />}
            </div>
            <p className="pl-6 text-xs text-muted-foreground">{m.description}</p>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <div className="flex items-center justify-between gap-2 px-2 py-2">
          <div className="flex flex-col">
            <span className="text-[13px] font-medium">Full-build-only</span>
            <span className="text-xs text-muted-foreground">
              Silent AI checker rejects placeholders, partials, diversions.
            </span>
          </div>
          <Switch
            checked={fullBuildOnly}
            onCheckedChange={onFullBuildOnlyChange}
            aria-label="Full-build-only mode"
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModeIcon({ mode }: { mode: ChatMode }) {
  if (mode === "auto") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  if (mode === "plan") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
