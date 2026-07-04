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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export interface IntegrationState {
  provider: string;
  label: string;
  description: string;
  icon: string;
  enabled: boolean;
  hasKey: boolean;
}

interface IntegrationsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integrations: IntegrationState[];
  onSave: (provider: string, credentials: Record<string, string>) => Promise<{ ok: boolean; message: string }>;
  onToggle: (provider: string, enabled: boolean) => void;
}

export function IntegrationsPanel({
  open,
  onOpenChange,
  integrations,
  onSave,
  onToggle,
}: IntegrationsPanelProps) {
  const [activeProvider, setActiveProvider] = React.useState<string | null>(null);
  const [tokenValue, setTokenValue] = React.useState("");
  const [testing, setTesting] = React.useState(false);
  const { toast } = useToast();

  const active = integrations.find((i) => i.provider === activeProvider);

  async function handleSave() {
    if (!activeProvider) return;
    setTesting(true);
    try {
      const result = await onSave(activeProvider, { token: tokenValue });
      toast({
        title: result.ok ? "Connected" : "Failed",
        description: result.message,
      });
      if (result.ok) setTokenValue("");
    } finally {
      setTesting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold tracking-tight">
            Integrations
          </DialogTitle>
          <DialogDescription className="text-xs">
            Drop-in API key pattern. Paste a key, hit Connect. That's it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {integrations.map((i) => (
            <div
              key={i.provider}
              className={cn(
                "glass rounded-xl p-4 press-smooth",
                activeProvider === i.provider && "ring-1 ring-foreground/30"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  onClick={() => setActiveProvider(activeProvider === i.provider ? null : i.provider)}
                  className="flex flex-1 items-start gap-3 text-left"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground/5">
                    <ProviderIcon name={i.icon} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{i.label}</span>
                      {i.hasKey && (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                          Connected
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{i.description}</p>
                  </div>
                </button>
                <Switch
                  checked={i.enabled}
                  onCheckedChange={(v) => onToggle(i.provider, v)}
                  aria-label={`Toggle ${i.label}`}
                />
              </div>

              {activeProvider === i.provider && (
                <div className="mt-3 flex gap-2 border-t border-border pt-3">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor={`${i.provider}-token`} className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      API key / Token
                    </Label>
                    <Input
                      id={`${i.provider}-token`}
                      type="password"
                      value={tokenValue}
                      onChange={(e) => setTokenValue(e.target.value)}
                      placeholder="Paste your key here"
                      className="font-mono text-xs"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={!tokenValue || testing}
                    className="self-end"
                  >
                    {testing ? "Testing…" : "Connect"}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProviderIcon({ name }: { name: string }) {
  switch (name) {
    case "notion":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 4h12.5L20 7.5V20H4V4zm2 2v12h12V8.2L14.8 6H6zm2 2h2v8H8V8zm4 0h2l2 4V8h2v8h-2l-2-4v4h-2V8z" />
        </svg>
      );
    case "github":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.09.66-.22.66-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.5 9.5 0 0 1 12 6.8c.85 0 1.71.11 2.51.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85V21c0 .27.16.58.67.48A10 10 0 0 0 22 12c0-5.52-4.48-10-10-10z" />
        </svg>
      );
    case "courtroom5":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21h18M5 21V10l7-6 7 6v11M9 21v-6h6v6" />
        </svg>
      );
    case "localfs":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z" />
        </svg>
      );
    default:
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
      );
  }
}
