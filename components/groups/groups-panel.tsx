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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export interface GroupMember {
  id?: string;
  userId: string;
  role: string;
  email: string;
  name: string | null;
  joinedAt?: string;
}

export interface GroupData {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  members: GroupMember[];
  chatCount?: number;
  chats?: { id: string; title: string; updatedAt: string }[];
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  yourRole?: string;
}

interface GroupsPanelProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  // When the user creates / opens a group chat, we call onStartGroupChat
  // with the groupId so the parent page can route to it.
  onStartGroupChat: (groupId: string) => void;
}

export function GroupsPanel({ open, onOpenChange, onStartGroupChat }: GroupsPanelProps) {
  const [groups, setGroups] = React.useState<GroupData[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [showCreate, setShowCreate] = React.useState(false);
  const { toast } = useToast();

  // Create form
  const [form, setForm] = React.useState({
    name: "",
    description: "",
    memberEmails: "",
  });

  // Add member form (per active group)
  const [inviteEmail, setInviteEmail] = React.useState("");

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/groups");
      const j = await r.json();
      setGroups(j.groups ?? []);
    } catch {
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    // Fetch-on-open with a loading flag. The lint rule traces setState
    // into async continuations, which would forbid all effect-based
    // data fetching — a pattern react.dev explicitly documents as valid.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) refresh();
  }, [open, refresh]);

  async function loadGroupDetail(id: string) {
    try {
      const r = await fetch(`/api/groups/${id}`);
      if (!r.ok) return;
      const j = await r.json();
      setGroups((prev) => prev.map((g) => (g.id === id ? { ...j.group } : g)));
      setActiveId(id);
    } catch {}
  }

  async function handleCreate() {
    if (!form.name.trim()) {
      toast({ title: "Missing name", variant: "destructive" });
      return;
    }
    const memberEmails = form.memberEmails
      .split(/[,\n\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const r = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        description: form.description,
        memberEmails,
      }),
    });
    const j = await r.json();
    if (j.group) {
      toast({
        title: "Group created",
        description: j.invited?.length
          ? `Added ${j.group.members.length} members. ${j.invited.length} need to sign up first: ${j.invited.join(", ")}`
          : `Added ${j.group.members.length} member(s).`,
      });
      setForm({ name: "", description: "", memberEmails: "" });
      setShowCreate(false);
      refresh();
    } else {
      toast({ title: "Create failed", description: j.error, variant: "destructive" });
    }
  }

  async function handleInvite() {
    if (!activeId || !inviteEmail.trim()) return;
    const r = await fetch(`/api/groups/${activeId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail }),
    });
    const j = await r.json();
    if (j.added) {
      toast({ title: "Member added", description: j.email });
      setInviteEmail("");
      loadGroupDetail(activeId);
    } else if (j.invited) {
      toast({
        title: "User not found",
        description: `${j.email} needs to sign up first.`,
        variant: "destructive",
      });
    } else {
      toast({ title: j.message ?? "Could not add", variant: "destructive" });
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!activeId) return;
    if (!confirm("Remove this member from the group?")) return;
    const r = await fetch(`/api/groups/${activeId}/members?userId=${userId}`, {
      method: "DELETE",
    });
    if (r.ok) {
      toast({ title: "Member removed" });
      loadGroupDetail(activeId);
    } else {
      const j = await r.json().catch(() => ({}));
      toast({ title: "Failed", description: j.error, variant: "destructive" });
    }
  }

  async function handleDeleteGroup() {
    if (!activeId) return;
    if (!confirm("Delete this group? All group chats will be lost. This cannot be undone.")) return;
    const r = await fetch(`/api/groups/${activeId}`, { method: "DELETE" });
    if (r.ok) {
      toast({ title: "Group deleted" });
      setActiveId(null);
      refresh();
    } else {
      const j = await r.json().catch(() => ({}));
      toast({ title: "Failed", description: j.error, variant: "destructive" });
    }
  }

  function handleStartGroupChat(groupId: string) {
    onStartGroupChat(groupId);
    onOpenChange(false);
  }

  const active = groups.find((g) => g.id === activeId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Groups</DialogTitle>
          <DialogDescription className="text-xs">
            Shared chats between specific accounts. Members see all group chats.
          </DialogDescription>
        </DialogHeader>

        {!active ? (
          <>
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs text-muted-foreground">
                {loading ? "Loading…" : `${groups.length} group(s)`}
              </span>
              <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
                {showCreate ? "Cancel" : "New group"}
              </Button>
            </div>

            {showCreate && (
              <div className="glass rounded-xl p-4 mb-3 space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Name</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Casework Team" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Description</Label>
                  <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Member emails (comma or space separated)
                  </Label>
                  <Textarea
                    value={form.memberEmails}
                    onChange={(e) => setForm({ ...form, memberEmails: e.target.value })}
                    placeholder="alice@example.com bob@example.com"
                    className="min-h-[60px] text-xs"
                  />
                </div>
                <Button onClick={handleCreate} className="w-full">Create group</Button>
              </div>
            )}

            <div className="space-y-2">
              {groups.length === 0 && !showCreate ? (
                <div className="glass rounded-xl p-8 text-center text-sm text-muted-foreground">
                  No groups yet. Create one to start shared chats.
                </div>
              ) : (
                groups.map((g) => (
                  <div key={g.id} className="glass rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <button onClick={() => loadGroupDetail(g.id)} className="flex-1 text-left min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm truncate">{g.name}</span>
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                            {g.members.length} member(s)
                          </Badge>
                          {g.yourRole && g.yourRole !== "MEMBER" && (
                            <Badge variant="secondary" className="text-[10px] uppercase">{g.yourRole}</Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground truncate">
                          {g.description || g.slug}
                        </p>
                      </button>
                      <Button size="sm" variant="outline" onClick={() => handleStartGroupChat(g.id)}>
                        New group chat
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <button onClick={() => setActiveId(null)} className="text-xs text-muted-foreground hover:text-foreground mb-1">
                  ← Back to groups
                </button>
                <h3 className="text-base font-semibold">{active.name}</h3>
                <p className="text-xs text-muted-foreground">{active.description || active.slug}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleStartGroupChat(active.id)}>New group chat</Button>
                {active.yourRole === "OWNER" && (
                  <Button size="sm" variant="ghost" className="text-red-500" onClick={handleDeleteGroup}>Delete</Button>
                )}
              </div>
            </div>

            {/* Members */}
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                Members ({active.members.length})
              </div>
              <div className="space-y-1">
                {active.members.map((m) => (
                  <div key={m.userId} className="glass rounded-lg px-3 py-2 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium truncate">{m.name ?? m.email}</span>
                      <Badge variant="outline" className="text-[9px] uppercase">{m.role}</Badge>
                      <span className="text-muted-foreground truncate">{m.email}</span>
                    </div>
                    {active.yourRole !== "MEMBER" && m.role !== "OWNER" && (
                      <button
                        onClick={() => handleRemoveMember(m.userId)}
                        className="text-red-500 hover:underline text-[10px]"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Invite */}
              <div className="mt-3 flex gap-2">
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="text-xs"
                />
                <Button size="sm" onClick={handleInvite} disabled={!inviteEmail.trim()}>Add member</Button>
              </div>
            </div>

            {/* Group chats */}
            {active.chats && active.chats.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                  Group chats ({active.chats.length})
                </div>
                <div className="space-y-1">
                  {active.chats.map((c) => (
                    <div key={c.id} className="glass rounded-lg px-3 py-2 text-xs">
                      <div className="font-medium truncate">{c.title}</div>
                      <div className="text-muted-foreground text-[10px]">
                        {new Date(c.updatedAt).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
