"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface CommandAction {
  id: string;
  label: string;
  hint?: string;
  group: "Chat" | "Mode" | "View" | "Tools" | "Navigate";
  shortcut?: string;
  run: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  actions,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  actions: CommandAction[];
}) {
  const [query, setQuery] = React.useState("");
  const [activeIdx, setActiveIdx] = React.useState(0);

  // Reset on open
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
    }
  }, [open]);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return actions;
    const q = query.toLowerCase();
    return actions.filter((a) => a.label.toLowerCase().includes(q) || a.group.toLowerCase().includes(q));
  }, [query, actions]);

  // Group
  const grouped = React.useMemo(() => {
    const m = new Map<string, CommandAction[]>();
    for (const a of filtered) {
      if (!m.has(a.group)) m.set(a.group, []);
      m.get(a.group)!.push(a);
    }
    return Array.from(m.entries());
  }, [filtered]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const action = filtered[activeIdx];
      if (action) {
        action.run();
        onOpenChange(false);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden top-[20%] translate-y-0">
        <div className="border-b border-border p-3">
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search commands…"
            className="w-full bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-96 overflow-y-auto p-2">
          {grouped.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">No matches.</div>
          ) : (
            grouped.map(([group, items]) => (
              <div key={group} className="mb-2">
                <div className="px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {group}
                </div>
                {items.map((action) => {
                  const idx = filtered.indexOf(action);
                  return (
                    <button
                      key={action.id}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => {
                        action.run();
                        onOpenChange(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm press-smooth",
                        activeIdx === idx ? "glass text-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <div className="flex flex-col">
                        <span>{action.label}</span>
                        {action.hint && (
                          <span className="text-[10px] text-muted-foreground">{action.hint}</span>
                        )}
                      </div>
                      {action.shortcut && (
                        <kbd className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] font-mono">
                          {action.shortcut}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
