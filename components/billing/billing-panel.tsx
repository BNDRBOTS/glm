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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface BillingPlan {
  id: string;
  name: string;
  priceMonthly: number;
  features: string[];
}

// Mirror of PLANS in lib/billing/stripe.ts (kept client-side so the
// panel renders without a fetch; the server is still the source of
// truth for what's actually configured).
const PLANS: BillingPlan[] = [
  {
    id: "power",
    name: "Power",
    priceMonthly: 0,
    features: [
      "GLM 5.2 peak access",
      "Two isolated accounts",
      "Group share",
      "Code canvas",
      "Turn-by-turn memory",
      "All 6 connectors",
      "All 5 backends",
      "Voice input",
      "Skill system",
    ],
  },
  {
    id: "team",
    name: "Team",
    priceMonthly: 2900,
    features: [
      "Everything in Power",
      "Up to 10 members",
      "Shared integrations",
      "Priority rate limits",
      "Team analytics dashboard",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    priceMonthly: 4900,
    features: [
      "Everything in Team",
      "Unlimited members",
      "Custom connectors",
      "Pinecone memory mesh",
      "SLA + dedicated support",
    ],
  },
];

interface BillingPanelProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  billingConfigured: boolean;
}

/** Pure fetch helper — no state access, used by the open-effect. */
async function fetchBillingGroups(): Promise<{ id: string; name: string; stripeSubscriptionId?: string | null }[]> {
  try {
    const r = await fetch("/api/groups");
    const j = await r.json();
    return (j.groups ?? []).map((g: any) => ({
      id: g.id,
      name: g.name,
      stripeSubscriptionId: g.stripeSubscriptionId,
    }));
  } catch {
    return [];
  }
}

export function BillingPanel({ open, onOpenChange, billingConfigured }: BillingPanelProps) {
  const [groups, setGroups] = React.useState<{ id: string; name: string; stripeSubscriptionId?: string | null }[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [redirecting, setRedirecting] = React.useState<string | null>(null);
  const { toast } = useToast();

  // State updates only in async callbacks — never synchronously in
  // the effect body (react-hooks/set-state-in-effect).
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    fetchBillingGroups().then((groups) => {
      if (cancelled) return;
      setGroups(groups);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open]);

  async function handleCheckout(planId: string, groupId: string) {
    setRedirecting(`${planId}:${groupId}`);
    try {
      const r = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, groupId }),
      });
      const j = await r.json();
      if (j.url) {
        window.location.assign(j.url);
        return;
      }
      toast({
        title: "Billing not configured",
        description: j.message ?? "Set STRIPE_SECRET_KEY + STRIPE_PRICE_* env vars to enable billing.",
        variant: "destructive",
      });
    } catch (e) {
      toast({ title: "Checkout failed", description: String(e), variant: "destructive" });
    } finally {
      setRedirecting(null);
    }
  }

  async function handlePortal(groupId: string) {
    setRedirecting(`portal:${groupId}`);
    try {
      const r = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId }),
      });
      const j = await r.json();
      if (j.url) {
        window.location.assign(j.url);
        return;
      }
      toast({
        title: "Portal unavailable",
        description: j.error ?? "No Stripe customer is associated with this group yet.",
        variant: "destructive",
      });
    } catch (e) {
      toast({ title: "Portal failed", description: String(e), variant: "destructive" });
    } finally {
      setRedirecting(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Billing</DialogTitle>
          <DialogDescription className="text-xs">
            {billingConfigured
              ? "Subscribe a group to a plan, or manage an existing subscription via Stripe."
              : "Billing is not configured. Set STRIPE_SECRET_KEY + STRIPE_PRICE_* env vars to enable checkout."}
          </DialogDescription>
        </DialogHeader>

        {groups.length === 0 ? (
          <div className="glass rounded-xl p-8 text-center text-sm text-muted-foreground">
            {loading ? "Loading…" : "You need at least one group to subscribe. Create one in the Groups panel."}
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.id} className="glass rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-sm font-semibold">{g.name}</div>
                    {g.stripeSubscriptionId ? (
                      <Badge variant="secondary" className="text-[10px] uppercase mt-1">Subscribed</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] uppercase mt-1">Free</Badge>
                    )}
                  </div>
                  {g.stripeSubscriptionId && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handlePortal(g.id)}
                      disabled={redirecting === `portal:${g.id}`}
                    >
                      {redirecting === `portal:${g.id}` ? "Redirecting…" : "Manage subscription"}
                    </Button>
                  )}
                </div>

                {!g.stripeSubscriptionId && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {PLANS.map((p) => (
                      <div key={p.id} className="rounded-lg border border-border p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-semibold">{p.name}</span>
                          {p.priceMonthly === 0 ? (
                            <span className="text-xs text-muted-foreground">Free</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              ${(p.priceMonthly / 100).toFixed(0)}/mo
                            </span>
                          )}
                        </div>
                        <ul className="text-[10px] text-muted-foreground space-y-0.5 mb-3">
                          {p.features.slice(0, 3).map((f) => (
                            <li key={f} className="truncate">{f}</li>
                          ))}
                        </ul>
                        <Button
                          size="sm"
                          className="w-full"
                          disabled={redirecting === `${p.id}:${g.id}` || !billingConfigured}
                          onClick={() => handleCheckout(p.id, g.id)}
                        >
                          {redirecting === `${p.id}:${g.id}` ? "Redirecting…" : p.priceMonthly === 0 ? "Select" : "Subscribe"}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
