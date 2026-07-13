"use client";

import * as React from "react";
import { ChatContainer, type SessionInfo } from "@/components/chat/container";
import { useChatStore } from "@/stores/chat-store";
import { useToast } from "@/hooks/use-toast";
import type { ChatMessageProps } from "@/components/chat/message";
import type { IntegrationState } from "@/components/integrations/integrations-panel";
import type { SidebarChat } from "@/components/chat/sidebar";
import type { ChatMode } from "@/lib/permissions/modes";
import type { SkillData } from "@/components/skills/skills-panel";
import { applyTheme, loadPersistedTheme } from "@/lib/themes";

interface ChatRow { id: string; title: string; updatedAt: string; }

export default function HomePage() {
  const store = useChatStore();
  const { toast } = useToast();

  const [chats, setChats] = React.useState<SidebarChat[]>([]);
  const [activeChatId, setActiveChatId] = React.useState<string | null>(null);
  const [activeChatTitle, setActiveChatTitle] = React.useState<string>("");
  const [messages, setMessages] = React.useState<ChatMessageProps[]>([]);
  const [integrations, setIntegrations] = React.useState<IntegrationState[]>([]);
  const [skills, setSkills] = React.useState<SkillData[]>([]);
  const [mode, setMode] = React.useState<ChatMode>("auto");
  const [fullBuildOnly, setFullBuildOnly] = React.useState(false);
  const [activeSkillId, setActiveSkillId] = React.useState<string | null>(null);
  // When the user clicks "New group chat" in the Groups panel, we
  // stash the groupId here so the next handleSend creates a GROUP chat
  // tied to that group.
  const [pendingGroupId, setPendingGroupId] = React.useState<string | null>(null);
  const [distillation, setDistillation] = React.useState<{
    alignment: number;
    driftDetected: boolean;
    entityCount: number;
    factCount: number;
    decisionCount: number;
  } | null>(null);
  const [dashboardOpen, setDashboardOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [session, setSession] = React.useState<SessionInfo | null>(null);

  // Fetch session truth (replaces hardcoded account menu + sidebar footer)
  const refreshSession = React.useCallback(async () => {
    try {
      const r = await fetch("/api/session");
      if (!r.ok) return;
      const j = await r.json();
      setSession(j);
    } catch {
      // ignore — UI shows "Not signed in" via null
    }
  }, []);

  // Apply persisted theme on mount
  React.useEffect(() => {
    applyTheme(loadPersistedTheme());
  }, []);

  // Fetch existing chats + integrations + skills on mount. Previously
  // the sidebar showed "No chats yet" even when the DB had saved chats,
  // because there was no fetch on mount AND no /api/chats endpoint.
  const refreshChats = React.useCallback(async () => {
    try {
      const r = await fetch("/api/chats");
      if (!r.ok) return;
      const j = await r.json();
      if (Array.isArray(j.chats)) setChats(j.chats);
    } catch {
      // ignore — sidebar just shows empty
    }
  }, []);

  // Fetch integrations + skills on mount
  const refreshSkills = React.useCallback(async () => {
    try {
      const r = await fetch("/api/skills");
      const j = await r.json();
      if (j.skills) setSkills(j.skills);
    } catch {}
  }, []);

  React.useEffect(() => {
    refreshChats();
    refreshSession();
    Promise.all([
      fetch("/api/connectors").then((r) => r.json()).catch(() => ({ connectors: [] })),
      fetch("/api/backends").then((r) => r.json()).catch(() => ({ backends: [] })),
      fetch("/api/skills").then((r) => r.json()).catch(() => ({ skills: [] })),
    ]).then(([connectorsRes, backendsRes, skillsRes]) => {
      const all: IntegrationState[] = [
        ...(connectorsRes.connectors ?? []).map((c: any) => ({
          provider: c.id,
          label: c.label,
          description: c.description,
          icon: c.iconKey,
          enabled: true,
          hasKey: c.hasKey,
        })),
      ];
      setIntegrations(all);
      if (backendsRes.backends) {
        (window as any).__backends = backendsRes.backends;
      }
      if (skillsRes.skills) setSkills(skillsRes.skills);
    });
  }, []);

  // Cmd+K handler
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setPaletteOpen(false);
      }
    }
    function onClose() {
      setPaletteOpen(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("palette-close", onClose as EventListener);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("palette-close", onClose as EventListener);
    };
  }, []);

  // Streaming send
  async function handleSend(text: string, files: File[]) {
    const userMsg: ChatMessageProps = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
      attachments: files.map((f) => ({ filename: f.name, mimeType: f.type, size: f.size })),
    };
    const assistantMsg: ChatMessageProps = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      model: store.model,
      streaming: true,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, userMsg, assistantMsg]);
    store.setStreaming(true);

    // Use AbortController so navigating away cancels server stream
    const controller = new AbortController();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: activeChatId,
          model: store.model,
          text,
          mode,
          fullBuildOnly,
          skillId: activeSkillId,
          groupId: pendingGroupId,
          attachments: await Promise.all(
            files.map(async (f) => ({
              filename: f.name,
              mimeType: f.type,
              data: await fileToBase64(f),
            }))
          ),
        }),
        signal: controller.signal,
      });
      // groupId is consumed on chat creation only — clear it so the next
      // message in this chat goes to the same chat (not a new group chat).
      setPendingGroupId(null);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let chatIdFromServer: string | null = null;
      let msgIdFromServer: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            switch (evt.type) {
              case "start":
                chatIdFromServer = evt.chatId;
                msgIdFromServer = evt.messageId;
                if (!activeChatId) {
                  setActiveChatId(evt.chatId);
                  setActiveChatTitle(text.slice(0, 60));
                }
                break;
              case "token":
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsg.id ? { ...m, content: m.content + evt.token } : m
                  )
                );
                break;
              case "tool-call-cleaning":
                // Server stripped the raw tool-call directives from the
                // visible output. Replace the streamed content with the
                // cleaned version so the user doesn't see JSON blocks.
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsg.id ? { ...m, content: evt.cleanedOutput } : m
                  )
                );
                break;
              case "tool-call-running":
                toast({
                  title: "Running connector call",
                  description: `${evt.provider}.${evt.kind}`,
                });
                break;
              case "tool-call-synthesis-start":
                // Clear the visible content so the synthesis stream
                // replaces it cleanly (otherwise we'd see the AI's
                // pre-synthesis output stuck on top).
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsg.id ? { ...m, content: "" } : m
                  )
                );
                break;
              case "tool-call-synthesis-done":
                // Synthesis stream already populated the content via
                // `token` events. Nothing to do here.
                break;
              case "quality-retry":
                toast({
                  title: "Quality check running",
                  description: "Silent AI checker detected slop. Retrying with feedback…",
                });
                break;
              case "quality-warning":
                toast({
                  title: "Quality warning",
                  description: `Slop patterns detected: ${evt.slop.join(", ")}. Retries: ${evt.attempts}.`,
                  variant: "destructive",
                });
                break;
              case "quality-retries":
                if (evt.attempts > 1) {
                  toast({
                    title: `Clean output after ${evt.attempts} attempts`,
                    description: "Silent checker caught and fixed issues before delivery.",
                  });
                }
                break;
              case "distillation":
                setDistillation({
                  alignment: evt.state.overallAlignment,
                  driftDetected: evt.state.driftDetected,
                  entityCount: evt.state.entityCount,
                  factCount: evt.state.factCount,
                  decisionCount: evt.state.decisionCount,
                });
                break;
              case "plan-required":
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsg.id
                      ? { ...m, streaming: false, content: m.content + "\n\n*[Plan mode — awaiting your approval]*" }
                      : m
                  )
                );
                toast({
                  title: "Plan ready for approval",
                  description: "AI produced a plan. Review and approve to execute.",
                });
                break;
              case "edit-required":
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsg.id
                      ? { ...m, streaming: false, content: m.content + "\n\n*[Accept-edits mode — awaiting your approval]*" }
                      : m
                  )
                );
                break;
              case "rejected":
                toast({
                  title: "Output rejected",
                  description: evt.reason,
                  variant: "destructive",
                });
                break;
              case "done":
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsg.id ? { ...m, streaming: false, tokens: evt.tokens } : m
                  )
                );
                break;
              case "error":
                toast({ title: "Stream error", description: evt.error });
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsg.id ? { ...m, streaming: false, content: m.content + `\n\n[error: ${evt.error}]` } : m
                  )
                );
                break;
            }
          } catch {}
        }
      }

      if (chatIdFromServer && !chats.find((c) => c.id === chatIdFromServer)) {
        setChats((c) => [
          { id: chatIdFromServer!, title: text.slice(0, 60), updatedAt: new Date().toISOString() },
          ...c,
        ]);
      } else if (chatIdFromServer) {
        // Bump the existing chat to the top of the sidebar with an
        // updated timestamp so the user sees their activity.
        setChats((c) => {
          const idx = c.findIndex((x) => x.id === chatIdFromServer);
          if (idx < 0) return c;
          const updated = { ...c[idx], updatedAt: new Date().toISOString() };
          return [updated, ...c.slice(0, idx), ...c.slice(idx + 1)];
        });
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      toast({ title: "Send failed", description: String(e) });
    } finally {
      store.setStreaming(false);
    }
  }

  function handleNewChat() {
    setMessages([]);
    setActiveChatId(null);
    setActiveChatTitle("");
    setDistillation(null);
  }

  // Load a chat's existing messages when the user selects it in the
  // sidebar. Previously clicking a chat only set activeChatId — the
  // message list stayed empty, so the user saw a blank chat thread.
  async function handleSelectChat(id: string) {
    setActiveChatId(id);
    setMessages([]);
    setDistillation(null);
    // Restore the intent-drift badge from the server-side distillation
    // state — otherwise it resets on every reload/chat switch even
    // though the state survives on the server.
    fetch(`/api/distillation?chatId=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.state) {
          setDistillation({
            alignment: j.state.overallAlignment,
            driftDetected: j.state.driftDetected,
            entityCount: j.state.entityCount,
            factCount: j.state.factCount,
            decisionCount: j.state.decisionCount,
          });
        }
      })
      .catch(() => {});
    try {
      const r = await fetch(`/api/chats/${id}`);
      if (!r.ok) {
        toast({ title: "Failed to load chat", description: `HTTP ${r.status}` });
        return;
      }
      const j = await r.json();
      setActiveChatTitle(j.chat?.title ?? "");
      if (j.chat?.mode) setMode(j.chat.mode);
      if (typeof j.chat?.fullBuildOnly === "boolean") setFullBuildOnly(j.chat.fullBuildOnly);
      if (Array.isArray(j.messages)) {
        setMessages(
          j.messages.map((m: any) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            model: m.model ?? undefined,
            tokens: m.tokens ?? undefined,
            createdAt: m.createdAt,
          }))
        );
      }
    } catch (e) {
      toast({ title: "Failed to load chat", description: String(e) });
    }
  }

  async function handleRenameChat(id: string, title: string) {
    const r = await fetch(`/api/chats/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      toast({ title: "Rename failed", description: j.error ?? `HTTP ${r.status}`, variant: "destructive" });
      return;
    }
    setChats((c) => c.map((x) => (x.id === id ? { ...x, title } : x)));
    if (activeChatId === id) setActiveChatTitle(title);
  }

  async function handleDeleteChat(id: string) {
    const r = await fetch(`/api/chats/${id}`, { method: "DELETE" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      toast({ title: "Delete failed", description: j.error ?? `HTTP ${r.status}`, variant: "destructive" });
      return;
    }
    setChats((c) => c.filter((x) => x.id !== id));
    if (activeChatId === id) {
      setActiveChatId(null);
      setActiveChatTitle("");
      setMessages([]);
      setDistillation(null);
    }
    toast({ title: "Chat deleted" });
  }

  async function handleTogglePin(id: string) {
    const chat = chats.find((c) => c.id === id);
    if (!chat) return;
    const pinned = !chat.pinned;
    // Optimistic update
    setChats((c) => c.map((x) => (x.id === id ? { ...x, pinned } : x)));
    const r = await fetch(`/api/chats/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    });
    if (!r.ok) {
      // Revert
      setChats((c) => c.map((x) => (x.id === id ? { ...x, pinned: !pinned } : x)));
      const j = await r.json().catch(() => ({}));
      toast({ title: "Pin failed", description: j.error ?? `HTTP ${r.status}`, variant: "destructive" });
    }
  }

  // Called when the user clicks "New group chat" in the Groups panel.
  // Resets the current chat context + stashes the groupId so the next
  // /api/chat call creates a GROUP chat tied to that group.
  function handleStartGroupChat(groupId: string) {
    setMessages([]);
    setActiveChatId(null);
    setActiveChatTitle("");
    setDistillation(null);
    setPendingGroupId(groupId);
    toast({
      title: "Group chat ready",
      description: "Send your first message to start the group chat.",
    });
  }

  async function handleSaveIntegration(provider: string, credentials: Record<string, string>) {
    const res = await fetch("/api/connectors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, credentials }),
    });
    const j = await res.json();
    if (j.ok) {
      setIntegrations((prev) =>
        prev.map((i) => (i.provider === provider ? { ...i, hasKey: true } : i))
      );
    }
    return j;
  }

  function handleToggleIntegration(provider: string, enabled: boolean) {
    setIntegrations((prev) =>
      prev.map((i) => (i.provider === provider ? { ...i, enabled } : i))
    );
  }

  async function handleExportRaw() {
    if (!activeChatId) return;
    const res = await fetch("/api/exports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: activeChatId, type: "raw" }),
    });
    const blob = await res.blob();
    triggerDownload(blob, `chat-${activeChatId}-raw.json`);
  }

  async function handleExportAggregate() {
    if (!activeChatId) return;
    const res = await fetch("/api/exports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: activeChatId, type: "aggregated" }),
    });
    const blob = await res.blob();
    triggerDownload(blob, `chat-${activeChatId}-aggregate.json`);
  }

  // Command palette actions
  const paletteActions = React.useMemo(
    () => [
      { id: "new-chat", label: "New chat", group: "Chat" as const, shortcut: "⌘N", run: handleNewChat },
      { id: "toggle-theme", label: "Toggle light/dark", group: "View" as const, run: () => {
        const isDark = document.documentElement.classList.contains("dark");
        document.documentElement.classList.toggle("dark", !isDark);
      }},
      { id: "open-themes", label: "Open theme switcher", group: "View" as const, run: () => (window as any).__openThemes?.() },
      { id: "open-canvas", label: "Open code canvas", group: "Tools" as const, run: () => (window as any).__openCanvas?.() },
      { id: "open-connectors", label: "Open connectors", group: "Tools" as const, run: () => (window as any).__openIntegrations?.() },
      { id: "open-skills", label: "Open skills", group: "Tools" as const, run: () => (window as any).__openSkills?.() },
      { id: "open-logs", label: "Open audit log", group: "Tools" as const, run: () => (window as any).__openLogs?.() },
      { id: "open-dashboard", label: "Open token dashboard", group: "Tools" as const, run: () => setDashboardOpen(true) },
      { id: "open-exports", label: "Open memory & exports", group: "Tools" as const, run: () => (window as any).__openExports?.() },
      { id: "open-groups", label: "Open groups", group: "Tools" as const, run: () => (window as any).__openGroups?.() },
      { id: "open-billing", label: "Open billing", group: "Tools" as const, run: () => (window as any).__openBilling?.() },
      { id: "mode-auto", label: "Set mode: Auto", group: "Mode" as const, run: () => setMode("auto") },
      { id: "mode-plan", label: "Set mode: Plan", group: "Mode" as const, run: () => setMode("plan") },
      { id: "mode-accept", label: "Set mode: Accept edits", group: "Mode" as const, run: () => setMode("accept-edits") },
      { id: "toggle-fbo", label: "Toggle full-build-only", group: "Mode" as const, run: () => setFullBuildOnly((v) => !v) },
    ],
    []
  );

  function handleApplySkill(skillId: string) {
    setActiveSkillId(skillId);
    const skill = skills.find((s) => s.id === skillId);
    if (skill) {
      setMode(skill.mode);
      setFullBuildOnly(skill.fullBuildOnly);
      toast({
        title: `Skill applied: ${skill.name}`,
        description: `Mode: ${skill.mode} · Full-build-only: ${skill.fullBuildOnly ? "on" : "off"}`,
      });
    }
  }

  return (
    <ChatContainer
      chats={chats}
      activeChatId={activeChatId}
      activeChatTitle={activeChatTitle}
      messages={messages}
      integrations={integrations}
      skills={skills}
      mode={mode}
      fullBuildOnly={fullBuildOnly}
      onModeChange={setMode}
      onFullBuildOnlyChange={setFullBuildOnly}
      distillation={distillation}
      onOpenDashboard={() => setDashboardOpen(true)}
      onOpenPalette={() => setPaletteOpen(true)}
      paletteOpen={paletteOpen}
      paletteActions={paletteActions}
      dashboardOpen={dashboardOpen}
      onDashboardOpenChange={setDashboardOpen}
      onSelectChat={handleSelectChat}
      onNewChat={handleNewChat}
      onSend={handleSend}
      onSaveIntegration={handleSaveIntegration}
      onToggleIntegration={handleToggleIntegration}
      onExportRaw={handleExportRaw}
      onExportAggregate={handleExportAggregate}
      onRefreshSkills={refreshSkills}
      onApplySkill={handleApplySkill}
      session={session}
      onRenameChat={handleRenameChat}
      onDeleteChat={handleDeleteChat}
      onTogglePin={handleTogglePin}
      onStartGroupChat={handleStartGroupChat}
    />
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Read a File as base64 string (without the data: prefix). Used to
 * send attachments inline with the chat request body.
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix if present
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
