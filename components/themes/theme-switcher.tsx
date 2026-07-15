"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { THEMES, applyTheme, loadPersistedTheme, type ThemeDefinition } from "@/lib/themes";

export function ThemeSwitcher({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  // Lazy initializer reads the persisted theme once on the client.
  // The dialog content only renders after user interaction (open starts
  // false), so this cannot cause a hydration mismatch, and it removes
  // the setState-in-effect cascade the mount effect had.
  const [active, setActive] = React.useState<string>(() =>
    typeof window === "undefined" ? "obsidian" : loadPersistedTheme()
  );

  function handleSelect(theme: ThemeDefinition) {
    setActive(theme.id);
    applyTheme(theme.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Theme</DialogTitle>
          <DialogDescription className="text-xs">
            Black/gray/charcoal base + 2-4 accent colors. All themes pass WCAG AA contrast.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              onClick={() => handleSelect(theme)}
              className={cn(
                "glass rounded-xl p-4 text-left press-smooth",
                active === theme.id && "ring-2 ring-foreground/40"
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold">{theme.name}</span>
                {active === theme.id && <Badge variant="secondary" className="text-[10px]">ACTIVE</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mb-3">{theme.description}</p>
              <div className="flex gap-1.5">
                {/* Dark swatch */}
                <div className="flex-1 rounded-md p-2" style={{ background: "#000" }}>
                  <div className="flex gap-1">
                    <div className="h-3 w-3 rounded-full" style={{ background: theme.dark.accent }} />
                    <div className="h-3 w-3 rounded-full" style={{ background: theme.dark.accentSecondary }} />
                    <div className="h-3 w-3 rounded-full" style={{ background: theme.dark.accentTertiary }} />
                    <div className="h-3 w-3 rounded-full" style={{ background: theme.dark.accentDanger }} />
                  </div>
                </div>
                {/* Light swatch */}
                <div className="flex-1 rounded-md p-2" style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.1)" }}>
                  <div className="flex gap-1">
                    <div className="h-3 w-3 rounded-full" style={{ background: theme.light.accent }} />
                    <div className="h-3 w-3 rounded-full" style={{ background: theme.light.accentSecondary }} />
                    <div className="h-3 w-3 rounded-full" style={{ background: theme.light.accentTertiary }} />
                    <div className="h-3 w-3 rounded-full" style={{ background: theme.light.accentDanger }} />
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
