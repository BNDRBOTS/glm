"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { signOut } from "next-auth/react";

/**
 * Account settings.
 * ---------------------------------------------------------------------
 * - Change password (requires current password)
 * - Delete account (irreversible — cascades to all user data via
 *   Prisma onDelete: Cascade on every relation)
 *
 * Reads session from /api/session to show the current email.
 */
export default function SettingsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [session, setSession] = React.useState<{ user: { email: string; name: string | null } | null } | null>(null);

  // Change-password form. State vars are prefixed with `pw` to avoid
  // shadowing the global `confirm()` function used by the delete flow.
  const [pwCurrent, setPwCurrent] = React.useState("");
  const [pwNext, setPwNext] = React.useState("");
  const [pwConfirm, setPwConfirm] = React.useState("");
  const [changingPw, setChangingPw] = React.useState(false);

  // Delete-account form
  const [deleteConfirm, setDeleteConfirm] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json())
      .then(setSession)
      .catch(() => {});
  }, []);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pwNext.length < 8) {
      toast({ title: "Password too short", description: "Use at least 8 characters.", variant: "destructive" });
      return;
    }
    if (pwNext !== pwConfirm) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    setChangingPw(true);
    try {
      const r = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNext }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        toast({ title: "Change failed", description: j.error ?? "HTTP " + r.status, variant: "destructive" });
        return;
      }
      toast({ title: "Password changed", description: "Use your new password next time you sign in." });
      setPwCurrent("");
      setPwNext("");
      setPwConfirm("");
    } catch (e) {
      toast({ title: "Change failed", description: String(e), variant: "destructive" });
    } finally {
      setChangingPw(false);
    }
  }

  async function handleDeleteAccount() {
    const email = session?.user?.email ?? "";
    if (deleteConfirm !== email) {
      toast({
        title: "Type your email to confirm",
        description: "The confirmation text must match your email exactly.",
        variant: "destructive",
      });
      return;
    }
    if (!confirm("Delete your account permanently? All chats, skills, integrations, and audit logs will be lost. This cannot be undone.")) {
      return;
    }
    setDeleting(true);
    try {
      const r = await fetch("/api/auth/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmEmail: deleteConfirm }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        toast({ title: "Delete failed", description: j.error ?? "HTTP " + r.status, variant: "destructive" });
        return;
      }
      toast({ title: "Account deleted" });
      await signOut({ callbackUrl: "/signin" });
    } catch (e) {
      toast({ title: "Delete failed", description: String(e), variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="dark-bg-vignette min-h-screen w-full p-6">
      <div className="mx-auto w-full max-w-md py-12">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground text-background">
            <SparkBig />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-gradient-bold">
            Account settings
          </h1>
          {session?.user?.email && (
            <p className="mt-1 text-xs text-muted-foreground font-mono">{session.user.email}</p>
          )}
        </div>

        {/* Change password */}
        <div className="glass rounded-2xl p-5 mb-4">
          <h2 className="text-sm font-semibold mb-3">Change password</h2>
          <form onSubmit={handleChangePassword} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="current" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Current password
              </Label>
              <Input
                id="current"
                type="password"
                autoComplete="current-password"
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="next" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                New password
              </Label>
              <Input
                id="next"
                type="password"
                autoComplete="new-password"
                value={pwNext}
                onChange={(e) => setPwNext(e.target.value)}
                placeholder="At least 8 characters"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-next" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Confirm new password
              </Label>
              <Input
                id="confirm-next"
                type="password"
                autoComplete="new-password"
                value={pwConfirm}
                onChange={(e) => setPwConfirm(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={changingPw} className="w-full">
              {changingPw ? "Changing…" : "Change password"}
            </Button>
          </form>
        </div>

        {/* Delete account */}
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5">
          <h2 className="text-sm font-semibold mb-1 text-red-500">Delete account</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Permanently deletes your account, chats, skills, integrations, and audit logs. This cannot be undone.
          </p>
          <div className="space-y-1.5 mb-3">
            <Label htmlFor="delete-confirm" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Type your email to confirm
            </Label>
            <Input
              id="delete-confirm"
              type="email"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={session?.user?.email ?? "your@email.com"}
            />
          </div>
          <Button
            variant="outline"
            disabled={deleting || !deleteConfirm}
            onClick={handleDeleteAccount}
            className="w-full border-red-500/40 text-red-500 hover:bg-red-500/10 hover:text-red-500"
          >
            {deleting ? "Deleting…" : "Delete my account"}
          </Button>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          <a href="/" className="text-foreground underline underline-offset-2 hover:opacity-70">
            Back to app
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
