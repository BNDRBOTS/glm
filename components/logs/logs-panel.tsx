"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface AuditLogRow {
  id: string;
  userId: string | null;
  source: string;
  level: string;
  event: string;
  payload: Record<string, unknown> | null;
  chatId: string | null;
  createdAt: string;
}

interface LogsPanelProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const SOURCE_LABELS: Record<string, string> = {
  chat: "Chat",
  voice: "Voice",
  connector: "Connector",
  backend: "Backend",
  quality: "Quality",
  distillation: "Distillation",
  billing: "Billing",
  skill: "Skill",
  auth: "Auth",
  system: "System",
};

const LEVEL_COLORS: Record<string, string> = {
  info: "text-muted-foreground",
  warn: "text-amber-500",
  error: "text-red-500",
  debug: "text-muted-foreground",
};

export function LogsPanel({ open, onOpenChange }: LogsPanelProps) {
  const [logs, setLogs] = React.useState<AuditLogRow[]>([]);
  const [filterSource, setFilterSource] = React.useState<string>("");
  const [filterLevel, setFilterLevel] = React.useState<string>("");
  const [loading, setLoading] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const fetchLogs = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterSource) params.set("source", filterSource);
      if (filterLevel) params.set("level", filterLevel);
      params.set("limit", "200");
      const r = await fetch(`/api/audit?${params}`);
      const j = await r.json();
      setLogs(j.rows ?? []);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [filterSource, filterLevel]);

  React.useEffect(() => {
    // Fetch-on-open with a loading flag. The lint rule traces setState
    // into async continuations, which would forbid all effect-based
    // data fetching — a pattern react.dev explicitly documents as valid.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) fetchLogs();
  }, [open, fetchLogs]);

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleExport() {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handlePrune() {
    if (!confirm("Prune old logs (keep last 10,000 per user)?")) return;
    const r = await fetch("/api/audit", { method: "DELETE" });
    const j = await r.json();
    fetchLogs();
    alert(`Pruned ${j.pruned} old entries.`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>Audit log</DialogTitle>
              <DialogDescription className="text-xs">
                Unified log of every system event. Filter by source + level. Click any entry to expand payload.
              </DialogDescription>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={fetchLogs} disabled={loading}>
                {loading ? "Loading…" : "Refresh"}
              </Button>
              <Button size="sm" variant="outline" onClick={handleExport}>Export</Button>
              <Button size="sm" variant="ghost" onClick={handlePrune}>Prune</Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex gap-2 mb-3">
          <select
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value)}
            className="rounded-md border border-border bg-transparent px-3 py-1.5 text-xs"
          >
            <option value="">All sources</option>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
            className="rounded-md border border-border bg-transparent px-3 py-1.5 text-xs"
          >
            <option value="">All levels</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
            <option value="debug">Debug</option>
          </select>
          <div className="ml-auto text-xs text-muted-foreground">
            {logs.length} entries
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1 -mx-2 px-2">
          {logs.length === 0 ? (
            <div className="glass rounded-xl p-8 text-center text-sm text-muted-foreground">
              {loading ? "Loading…" : "No log entries match your filters."}
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className="glass rounded-lg px-3 py-2 cursor-pointer press-smooth"
                onClick={() => toggleExpanded(log.id)}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground tabular-nums">
                    {new Date(log.createdAt).toLocaleTimeString()}
                  </span>
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                    {SOURCE_LABELS[log.source] ?? log.source}
                  </Badge>
                  <span className={cn("text-[10px] uppercase tracking-wider font-medium", LEVEL_COLORS[log.level])}>
                    {log.level}
                  </span>
                  <span className="text-sm font-mono">{log.event}</span>
                  {log.chatId && (
                    <span className="ml-auto text-[10px] text-muted-foreground font-mono">
                      chat:{log.chatId.slice(-8)}
                    </span>
                  )}
                </div>
                {expanded.has(log.id) && log.payload && (
                  <pre className="mt-2 text-[11px] font-mono whitespace-pre-wrap text-muted-foreground bg-foreground/5 rounded p-2 overflow-x-auto">
                    {JSON.stringify(log.payload, null, 2)}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
