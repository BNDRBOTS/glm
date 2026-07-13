"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface CanvasState {
  kind: "html" | "react";
  source: string;
  history: { id: string; kind: "html" | "react"; source: string; createdAt: string }[];
}

interface CanvasPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: CanvasState | null;
  onStateChange: (state: CanvasState) => void;
  onBack: () => void;
  canGoBack: boolean;
  // Active chat id — when set, snapshots are loaded from / persisted to
  // the server. Without it, canvas is in-memory only (new chat flow).
  chatId?: string | null;
  onToast?: (msg: string) => void;
}

export function CanvasPanel({
  open,
  onOpenChange,
  state,
  onStateChange,
  onBack,
  canGoBack,
  chatId,
  onToast,
}: CanvasPanelProps) {
  const [kind, setKind] = React.useState<"html" | "react">(state?.kind ?? "html");
  const [source, setSource] = React.useState(state?.source ?? defaultHtml);
  const [saving, setSaving] = React.useState(false);

  // Adjust local editor state when the parent-provided snapshot changes.
  // Done during render (react.dev "adjusting state when a prop changes")
  // instead of an effect — avoids the extra render cascade.
  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state) {
      setKind(state.kind);
      setSource(state.source);
    }
  }

  // Load most recent snapshot when the panel opens for an existing chat
  // (and there's no in-memory state yet).
  React.useEffect(() => {
    if (!open || !chatId || state) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/canvas/${chatId}`);
        if (!r.ok) return;
        const j = await r.json();
        const snaps: any[] = j.snapshots ?? [];
        if (snaps.length === 0 || cancelled) return;
        const latest = snaps[0]; // newest first
        setKind(latest.kind === "react" ? "react" : "html");
        setSource(latest.source);
        onStateChange({
          kind: latest.kind === "react" ? "react" : "html",
          source: latest.source,
          history: snaps
            .slice()
            .reverse()
            .map((s: any) => ({
              id: s.id,
              kind: s.kind === "react" ? "react" : "html",
              source: s.source,
              createdAt: s.createdAt,
            })),
        });
      } catch {
        // ignore — fall back to default
      }
    })();
    return () => { cancelled = true; };
  }, [open, chatId]);

  const sandboxDoc = React.useMemo(() => {
    if (kind === "html") return wrapHtml(source);
    return wrapReact(source);
  }, [kind, source]);

  function handleKindChange(k: "html" | "react") {
    setKind(k);
    if (k === "html" && (!source || source.includes("function App"))) setSource(defaultHtml);
    if (k === "react" && (!source || source.startsWith("<div"))) setSource(defaultReact);
  }

  async function handleSave() {
    onStateChange({
      kind,
      source,
      history: state?.history ?? [],
    });
    // Persist to server when bound to a chat.
    if (chatId) {
      setSaving(true);
      try {
        const r = await fetch(`/api/canvas/${chatId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, source }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          onToast?.(`Snapshot failed: ${j.error ?? r.status}`);
        } else {
          onToast?.("Snapshot saved");
        }
      } catch (e) {
        onToast?.(`Snapshot failed: ${String(e)}`);
      } finally {
        setSaving(false);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[85vh] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base font-semibold tracking-tight">
                Code Canvas
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Live preview · HTML & React · version history with back button
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onBack}
                disabled={!canGoBack}
                className="gap-1.5"
              >
                <BackIcon />
                <span>Back</span>
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
                <SaveIcon />
                <span>{saving ? "Saving…" : "Snapshot"}</span>
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          <Tabs
            value={kind}
            onValueChange={(v) => handleKindChange(v as "html" | "react")}
            className="h-full flex flex-col"
          >
            <div className="px-4 pt-3 border-b border-border">
              <TabsList className="bg-transparent">
                <TabsTrigger value="html" className="gap-1.5">
                  <CodeIcon /> HTML
                </TabsTrigger>
                <TabsTrigger value="react" className="gap-1.5">
                  <AtomIcon /> React
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value={kind} className="flex-1 m-0 mt-0 overflow-hidden">
              <div className="grid h-full grid-cols-2 gap-0">
                {/* Editor */}
                <div className="border-r border-border flex flex-col">
                  <div className="px-4 py-2 border-b border-border text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Source
                  </div>
                  <Textarea
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    spellCheck={false}
                    className="flex-1 m-0 resize-none rounded-none border-0 bg-transparent font-mono text-[13px] leading-relaxed focus-visible:ring-0"
                  />
                </div>

                {/* Preview */}
                <div className="flex flex-col bg-white">
                  <div className="px-4 py-2 border-b border-border text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Live Preview
                  </div>
                  <iframe
                    title="canvas-preview"
                    sandbox="allow-scripts allow-same-origin"
                    srcDoc={sandboxDoc}
                    className="flex-1 w-full border-0 bg-white"
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {state && state.history.length > 0 && (
          <div className="border-t border-border px-5 py-3 max-h-32 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
              History ({state.history.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {state.history.slice(-8).map((h, i) => (
                <div
                  key={h.id}
                  className={cn(
                    "glass rounded-md px-2 py-1 text-[10px] font-mono",
                    i === state.history.length - 1 && "ring-1 ring-foreground/30"
                  )}
                >
                  {h.kind} · {new Date(h.createdAt).toLocaleTimeString()}
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ----- Default sources -----------------------------------------------

const defaultHtml = `<div style="padding:24px;font-family:system-ui">
  <h1 style="margin:0 0 8px">Hello, canvas</h1>
  <p style="margin:0;color:#555">Edit the source on the left. Preview updates live.</p>
  <button style="margin-top:16px;padding:8px 16px;background:#000;color:#fff;border:none;border-radius:8px;cursor:pointer">
    Click me
  </button>
</div>`;

const defaultReact = `function App() {
  return React.createElement('div', { style: { padding: 24, fontFamily: 'system-ui' } },
    React.createElement('h1', { style: { margin: '0 0 8px' } }, 'Hello, React canvas'),
    React.createElement('p', { style: { margin: 0, color: '#555' } }, 'Edit on the left. Live preview.'),
  );
}`;

function wrapHtml(source: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:#fff;color:#000}
  </style></head><body>${source}</body></html>`;
}

function wrapReact(source: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
    <style>
      *{box-sizing:border-box}
      body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:#fff;color:#000;padding:16px}
    </style>
    </head><body>
    <div id="root"></div>
    <script type="importmap">
    { "imports": {
      "react": "https://esm.sh/react@19",
      "react-dom/client": "https://esm.sh/react-dom@19/client"
    } }
    </script>
    <script type="module">
      import React from "react";
      import { createRoot } from "react-dom/client";
      ${source}
      const root = createRoot(document.getElementById("root"));
      root.render(React.createElement(App || (() => React.createElement('div', null, 'No App exported'))));
    </script>
    </body></html>`;
}

// ----- SVG icons -----------------------------------------------------

function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function AtomIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="1" />
      <path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5z" />
      <path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5z" />
    </svg>
  );
}
