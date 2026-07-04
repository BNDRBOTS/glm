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
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export interface SkillData {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  mode: "auto" | "plan" | "accept-edits";
  fullBuildOnly: boolean;
  allowedConnectors: string[];
  allowedBackends: string[];
  triggers: string[];
  version: number;
  origin: "local" | "imported";
  author?: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SkillsPanelProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  skills: SkillData[];
  onRefresh: () => void;
  onApply: (skillId: string) => void;
}

export function SkillsPanel({ open, onOpenChange, skills, onRefresh, onApply }: SkillsPanelProps) {
  const [showCreate, setShowCreate] = React.useState(false);
  const [showImport, setShowImport] = React.useState(false);
  const [importJson, setImportJson] = React.useState("");
  const { toast } = useToast();

  // Create form state
  const [form, setForm] = React.useState({
    name: "",
    description: "",
    systemPrompt: "",
    mode: "auto" as "auto" | "plan" | "accept-edits",
    fullBuildOnly: true,
    triggers: "",
  });

  async function handleCreate() {
    if (!form.name.trim() || !form.systemPrompt.trim()) {
      toast({ title: "Missing fields", description: "Name and system prompt are required.", variant: "destructive" });
      return;
    }
    const triggers = form.triggers.split(",").map((s) => s.trim()).filter(Boolean);
    const r = await fetch("/api/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        name: form.name,
        description: form.description,
        systemPrompt: form.systemPrompt,
        mode: form.mode,
        fullBuildOnly: form.fullBuildOnly,
        triggers,
      }),
    });
    const j = await r.json();
    if (j.skill) {
      toast({ title: "Skill created", description: `${j.skill.name} is ready to apply.` });
      setForm({ name: "", description: "", systemPrompt: "", mode: "auto", fullBuildOnly: true, triggers: "" });
      setShowCreate(false);
      onRefresh();
    } else {
      toast({ title: "Create failed", description: j.error, variant: "destructive" });
    }
  }

  async function handleImport() {
    if (!importJson.trim()) {
      toast({ title: "Missing JSON", description: "Paste a skill JSON to import.", variant: "destructive" });
      return;
    }
    const r = await fetch("/api/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "import", json: importJson }),
    });
    const j = await r.json();
    if (j.skill) {
      toast({ title: "Skill imported", description: `${j.skill.name} (v${j.skill.version}) by ${j.skill.author ?? "anonymous"}` });
      setImportJson("");
      setShowImport(false);
      onRefresh();
    } else {
      toast({ title: "Import failed", description: j.error, variant: "destructive" });
    }
  }

  async function handleExport(skillId: string) {
    const r = await fetch(`/api/skills/${skillId}/export`);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `skill-${skillId}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Skill exported", description: "Share the JSON with anyone — they can import via the Accepter tab." });
  }

  async function handleToggle(skillId: string, enabled: boolean) {
    await fetch(`/api/skills/${skillId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    onRefresh();
  }

  async function handleDelete(skillId: string) {
    if (!confirm("Delete this skill? This cannot be undone.")) return;
    await fetch(`/api/skills/${skillId}`, { method: "DELETE" });
    toast({ title: "Skill deleted" });
    onRefresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Skills</DialogTitle>
          <DialogDescription className="text-xs">
            Maker creates skills. Accepter imports skills from JSON. Reader applies them to the current chat.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="library">
          <TabsList>
            <TabsTrigger value="library">Library ({skills.length})</TabsTrigger>
            <TabsTrigger value="maker">Maker</TabsTrigger>
            <TabsTrigger value="accepter">Accepter</TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="mt-4 space-y-2">
            {skills.length === 0 ? (
              <div className="glass rounded-xl p-8 text-center text-sm text-muted-foreground">
                No skills yet. Use the Maker tab to create one, or Accepter to import.
              </div>
            ) : (
              skills.map((s) => (
                <div key={s.id} className="glass rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm truncate">{s.name}</span>
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                          {s.origin}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">v{s.version}</Badge>
                        <Badge variant="outline" className="text-[10px] uppercase">{s.mode}</Badge>
                        {s.fullBuildOnly && <Badge variant="outline" className="text-[10px]">FBO</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{s.description || "No description"}</p>
                      {s.triggers.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {s.triggers.slice(0, 5).map((t, i) => (
                            <span key={i} className="rounded bg-foreground/5 px-1.5 py-0.5 text-[10px] font-mono">"{t}"</span>
                          ))}
                        </div>
                      )}
                      {s.author && (
                        <div className="mt-2 text-[10px] text-muted-foreground">by {s.author}</div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Switch checked={s.enabled} onCheckedChange={(v) => handleToggle(s.id, v)} />
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => onApply(s.id)}>Apply</Button>
                        <Button size="sm" variant="ghost" onClick={() => handleExport(s.id)}>Export</Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(s.id)}>Delete</Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="maker" className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="skill-name" className="text-[10px] uppercase tracking-[0.18em]">Name</Label>
              <Input id="skill-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Courtroom5 Casework Assistant" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="skill-desc" className="text-[10px] uppercase tracking-[0.18em]">Description</Label>
              <Input id="skill-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What this skill does" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="skill-prompt" className="text-[10px] uppercase tracking-[0.18em]">System prompt</Label>
              <Textarea id="skill-prompt" value={form.systemPrompt} onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })} placeholder="You are a courtroom casework assistant. When the user describes a case, you..." className="font-mono text-xs min-h-[120px]" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-[0.18em]">Default mode</Label>
                <select
                  value={form.mode}
                  onChange={(e) => setForm({ ...form, mode: e.target.value as "auto" | "plan" | "accept-edits" })}
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
                >
                  <option value="auto">Auto</option>
                  <option value="plan">Plan</option>
                  <option value="accept-edits">Accept edits</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-[0.18em]">Triggers (comma-separated)</Label>
                <Input value={form.triggers} onChange={(e) => setForm({ ...form, triggers: e.target.value })} placeholder="case, lawsuit, court" />
              </div>
            </div>
            <div className="flex items-center justify-between glass rounded-lg p-3">
              <div>
                <div className="text-sm font-medium">Full-build-only</div>
                <div className="text-xs text-muted-foreground">Silent AI checker rejects slop when this skill is active</div>
              </div>
              <Switch checked={form.fullBuildOnly} onCheckedChange={(v) => setForm({ ...form, fullBuildOnly: v })} />
            </div>
            <Button onClick={handleCreate} className="w-full">Create skill</Button>
          </TabsContent>

          <TabsContent value="accepter" className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="import-json" className="text-[10px] uppercase tracking-[0.18em]">Skill JSON</Label>
              <Textarea
                id="import-json"
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                placeholder={`{\n  "type": "glm-skill",\n  "name": "...",\n  "systemPrompt": "...",\n  ...\n}`}
                className="font-mono text-xs min-h-[200px]"
              />
            </div>
            <Button onClick={handleImport} className="w-full">Import skill</Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
