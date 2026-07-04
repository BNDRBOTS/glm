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
import { cn } from "@/lib/utils";

export interface DashboardData {
  totals: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costCents: number;
    requestCount: number;
  };
  byModel: { model: string; totalTokens: number; requestCount: number }[];
  recent: {
    id: string;
    model: string;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    chatTitle: string | null;
    createdAt: string;
  }[];
}

export function DashboardPanel({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: DashboardData | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Token usage dashboard</DialogTitle>
          <DialogDescription className="text-xs">
            Live usage stats from your GLM calls. Stripe billing (when wired) consumes this same data.
          </DialogDescription>
        </DialogHeader>

        {!data ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Total tokens" value={fmt(data.totals.totalTokens)} />
              <Stat label="Requests" value={fmt(data.totals.requestCount)} />
              <Stat label="Prompt tokens" value={fmt(data.totals.promptTokens)} />
              <Stat label="Completion tokens" value={fmt(data.totals.completionTokens)} />
            </div>

            <Tabs defaultValue="model">
              <TabsList>
                <TabsTrigger value="model">By model</TabsTrigger>
                <TabsTrigger value="recent">Recent calls</TabsTrigger>
              </TabsList>

              <TabsContent value="model" className="mt-3">
                <div className="space-y-2">
                  {data.byModel.length === 0 ? (
                    <div className="text-center text-xs text-muted-foreground py-6">No calls yet.</div>
                  ) : (
                    data.byModel.map((m) => {
                      const max = Math.max(...data.byModel.map((x) => x.totalTokens), 1);
                      const pct = (m.totalTokens / max) * 100;
                      return (
                        <div key={m.model} className="glass rounded-lg p-3">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium">{m.model}</span>
                            <span className="text-muted-foreground">
                              {fmt(m.totalTokens)} tokens · {m.requestCount} calls
                            </span>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/10">
                            <div
                              className="h-full bg-foreground rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </TabsContent>

              <TabsContent value="recent" className="mt-3">
                <div className="max-h-80 space-y-1 overflow-y-auto">
                  {data.recent.length === 0 ? (
                    <div className="text-center text-xs text-muted-foreground py-6">No recent calls.</div>
                  ) : (
                    data.recent.map((r) => (
                      <div key={r.id} className="glass flex items-center justify-between rounded-lg px-3 py-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono font-medium">{r.model}</span>
                          <span className="truncate text-muted-foreground">
                            {r.chatTitle ?? "Untitled chat"}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-muted-foreground">{fmt(r.totalTokens)} tok</span>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(r.createdAt).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-xl p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}
