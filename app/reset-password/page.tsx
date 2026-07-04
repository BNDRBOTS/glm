"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

/**
 * Reset-password page. Reads ?token= from the URL, prompts for a new
 * password, POSTs to /api/auth/reset-password.
 *
 * If no token is present, shows an error state pointing back to
 * forgot-password.
 */
export default function ResetPasswordPage() {
  return (
    <React.Suspense fallback={<Fallback />}>
      <Form />
    </React.Suspense>
  );
}

function Fallback() {
  return (
    <div className="dark-bg-vignette flex min-h-screen w-full items-center justify-center p-6">
      <div className="w-full max-w-sm text-center text-sm text-muted-foreground">Loading…</div>
    </div>
  );
}

function Form() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const { toast } = useToast();
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (password.length < 8) {
      toast({ title: "Password too short", description: "Use at least 8 characters.", variant: "destructive" });
      return;
    }
    if (password !== confirm) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        toast({ title: "Reset failed", description: j.error ?? "Invalid or expired token.", variant: "destructive" });
        return;
      }
      toast({ title: "Password reset", description: "Sign in with your new password." });
      router.push("/signin");
    } catch (e) {
      toast({ title: "Reset failed", description: String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="dark-bg-vignette flex min-h-screen w-full items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground text-background">
            <SparkBig />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-gradient-bold">
            New password
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">Choose a new password for your account</p>
        </div>

        {!token ? (
          <div className="glass rounded-2xl p-5 space-y-3 text-center">
            <p className="text-sm text-foreground">
              No reset token found. The link may have been truncated.
            </p>
            <Button variant="outline" className="w-full" onClick={() => (window.location.href = "/forgot-password")}>
              Request a new link
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="glass rounded-2xl p-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                New password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Confirm new password
              </Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat your password"
                required
              />
              {confirm.length > 0 && password !== confirm && (
                <p className="text-[10px] text-red-500">Passwords don't match</p>
              )}
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Resetting…" : "Reset password"}
            </Button>
          </form>
        )}

        <p className="mt-4 text-center text-xs text-muted-foreground">
          <a href="/signin" className="text-foreground underline underline-offset-2 hover:opacity-70">
            Back to sign in
          </a>
        </p>
      </div>
    </div>
  );
}

function SparkBig() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 L13.5 10.5 L21 12 L13.5 13.5 L12 21 L10.5 13.5 L3 12 L10.5 10.5 Z" />
    </svg>
  );
}
