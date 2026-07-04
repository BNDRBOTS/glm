"use client";

import * as React from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

/**
 * Sign-up page. POSTs to /api/auth/signup (NOT NextAuth's signin),
 * then immediately calls NextAuth's signIn() to establish the session
 * — so the user lands on the home page logged in, no separate
 * verification step needed.
 *
 * Matches the /signin aesthetic exactly: same dark-bg-vignette
 * background, glass form card, text-gradient-bold title, SparkBig icon.
 */
export default function SignUpPage() {
  return (
    <React.Suspense fallback={<SignUpFallback />}>
      <SignUpForm />
    </React.Suspense>
  );
}

function SignUpFallback() {
  return (
    <div className="dark-bg-vignette flex min-h-screen w-full items-center justify-center p-6">
      <div className="w-full max-w-sm text-center text-sm text-muted-foreground">
        Loading…
      </div>
    </div>
  );
}

function SignUpForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  // Live password-strength meter — pure client heuristic, no network call.
  const strength = scorePassword(password);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast({ title: "Missing fields", description: "Email and password are required.", variant: "destructive" });
      return;
    }
    if (password.length < 8) {
      toast({ title: "Password too short", description: "Use at least 8 characters.", variant: "destructive" });
      return;
    }
    if (password !== confirm) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }

    setLoading(true);
    // 1. Create the account.
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name: name.trim() || undefined }),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) {
      setLoading(false);
      toast({
        title: "Sign up failed",
        description: j.error ?? `HTTP ${res.status}`,
        variant: "destructive",
      });
      return;
    }
    // 2. Immediately sign in (NextAuth credentials provider).
    const signInRes = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (signInRes?.error) {
      // Account was created but auto-signin failed — send them to /signin
      // with a clear message rather than dumping them on the home page
      // with no session.
      toast({
        title: "Account created",
        description: "Please sign in with your new credentials.",
      });
      router.push("/signin");
      return;
    }
    toast({ title: "Welcome", description: "Your account is ready." });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="dark-bg-vignette flex min-h-screen w-full items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground text-background">
            <SparkBig />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-gradient-bold">
            GLM Power Platform
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">Create your account</p>
        </div>

        <form onSubmit={handleSubmit} className="glass rounded-2xl p-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Name <span className="text-muted-foreground/60">(optional)</span>
            </Label>
            <Input
              id="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoFocus
            />
          </div>
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
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
            />
            {password.length > 0 && (
              <div className="flex items-center gap-1.5 pt-1">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-1 flex-1 rounded-full transition-colors"
                    style={{
                      background:
                        i < strength.score
                          ? strength.color
                          : "rgba(128,128,128,0.2)",
                    }}
                  />
                ))}
                <span className="ml-1 text-[10px] text-muted-foreground tabular-nums" style={{ color: strength.color }}>
                  {strength.label}
                </span>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Confirm password
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
            {loading ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <a href="/signin" className="text-foreground underline underline-offset-2 hover:opacity-70">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}

/**
 * Pure client-side password strength heuristic. Not a security check —
 * just a UX nudge. Real enforcement (min 8 chars) happens server-side
 * in /api/auth/signup.
 */
function scorePassword(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^a-zA-Z0-9]/.test(pw)) score++;
  const labels = ["Too short", "Weak", "Fair", "Good", "Strong"];
  const colors = ["#ff453a", "#ff453a", "#ffb000", "#7fb685", "#30d158"];
  const idx = Math.min(score, 4);
  return { score: idx, label: labels[idx], color: colors[idx] };
}

function SparkBig() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 L13.5 10.5 L21 12 L13.5 13.5 L12 21 L10.5 13.5 L3 12 L10.5 10.5 Z" />
    </svg>
  );
}
