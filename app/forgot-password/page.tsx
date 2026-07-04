"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

/**
 * Forgot-password page. POSTs to /api/auth/forgot-password.
 *
 * The API always returns the same message regardless of whether the
 * email exists — this prevents account enumeration. We show the same
 * success message here too.
 */
export default function ForgotPasswordPage() {
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
  const { toast } = useToast();
  const [email, setEmail] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      const r = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.toLowerCase().trim() }),
      });
      // Always treat as success to prevent enumeration.
      setSent(true);
    } catch {
      // Network error — still show success message to prevent enumeration
      // via timing. The user will retry if no email arrives.
      setSent(true);
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
            Reset password
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">We'll email you a reset link</p>
        </div>

        {sent ? (
          <div className="glass rounded-2xl p-5 space-y-3 text-center">
            <p className="text-sm text-foreground">
              If an account exists for <span className="font-mono">{email.toLowerCase().trim()}</span>,
              a reset link has been sent.
            </p>
            <p className="text-xs text-muted-foreground">
              The link expires in 1 hour. Check your spam folder if you don't see it.
            </p>
            <Button variant="outline" className="w-full" onClick={() => (window.location.href = "/signin")}>
              Back to sign in
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="glass rounded-2xl p-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourdomain.com"
                required
                autoFocus
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Sending…" : "Send reset link"}
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
