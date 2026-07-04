"use client";

import * as React from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

/**
 * Next 16 requires useSearchParams() to be inside a Suspense boundary
 * so the page can still prerender. We split the form into its own
 * component and wrap it here.
 */
export default function SignInPage() {
  return (
    <React.Suspense fallback={<SignInFallback />}>
      <SignInForm />
    </React.Suspense>
  );
}

function SignInFallback() {
  return (
    <div className="dark-bg-vignette flex min-h-screen w-full items-center justify-center p-6">
      <div className="w-full max-w-sm text-center text-sm text-muted-foreground">
        Loading…
      </div>
    </div>
  );
}

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/";
  const { toast } = useToast();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast({ title: "Missing fields", description: "Email and password are required.", variant: "destructive" });
      return;
    }
    setLoading(true);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl,
    });
    setLoading(false);
    if (res?.error) {
      toast({ title: "Sign in failed", description: "Check your email and password.", variant: "destructive" });
      return;
    }
    if (res?.url) router.push(res.url);
    else router.push(callbackUrl);
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
          <p className="mt-1 text-xs text-muted-foreground">Sign in to your account</p>
        </div>

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
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Don&apos;t have an account?{" "}
          <a href="/signup" className="text-foreground underline underline-offset-2 hover:opacity-70">
            Sign up
          </a>
        </p>
        <p className="mt-1 text-center text-xs text-muted-foreground">
          <a href="/forgot-password" className="text-foreground underline underline-offset-2 hover:opacity-70">
            Forgot password?
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
