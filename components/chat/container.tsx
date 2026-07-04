"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { ChatMessage, type ChatMessageProps } from "./message";
import { Composer } from "./composer";
import { Sidebar, type SidebarChat } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";
import { ModePicker } from "./mode-picker";
import { IntentDriftBadge, type DistillationBadge } from "./intent-drift-badge";
import { CommandPalette, type CommandAction } from "./command-palette";
import { DashboardPanel, type DashboardData } from "./dashboard/dashboard-panel";
import { CanvasPanel, type CanvasState } from "@/components/canvas/canvas-panel";
import {
  IntegrationsPanel,
  type IntegrationState,
} from "@/components/integrations/integrations-panel";
import { SkillsPanel, type SkillData } from "@/components/skills/skills-panel";
import { LogsPanel } from "@/components/logs/logs-panel";
import { ThemeSwitcher } from "@/components/themes/theme-switcher";
import { GroupsPanel } from "@/components/groups/groups-panel";
import { BillingPanel } from "@/components/billing/billing-panel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { ChatMode } from "@/lib/permissions/modes";

export interface SessionInfo {
  user: { id: string; email: string; name: string | null; role: string } | null;
  demoMode: boolean;
  glmConfigured: boolean;
  voiceConfigured: boolean;
  billingConfigured: boolean;
}

export interface ChatContainerProps {
  chats: SidebarChat[];
  activeChatId: string | null;
  activeChatTitle: string;
  messages: ChatMessageProps[];
  integrations: IntegrationState[];
  skills: SkillData[];
  // New: permissions
  mode: ChatMode;
  fullBuildOnly: boolean;
  onModeChange: (m: ChatMode) => void;
  onFullBuildOnlyChange: (v: boolean) => void;
  // New: distillation
  distillation: DistillationBadge | null;
  // New: dashboard + palette
  onOpenDashboard: () => void;
  onOpenPalette: () => void;
  paletteOpen: boolean;
  paletteActions: CommandAction[];
  dashboardOpen: boolean;
  onDashboardOpenChange: (v: boolean) => void;
  // Session truth (replaces hardcoded "owner@yourdomain.com" + "API key detected")
  session: SessionInfo | null;
  // Chat list ops
  onRenameChat: (id: string, title: string) => void;
  onDeleteChat: (id: string) => void;
  onTogglePin: (id: string) => void;
  // Existing
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onSend: (text: string, files: File[]) => Promise<void>;
  onSaveIntegration: (provider: string, credentials: Record<string, string>) => Promise<{ ok: boolean; message: string }>;
  onToggleIntegration: (provider: string, enabled: boolean) => void;
  onExportRaw: () => Promise<void>;
  onExportAggregate: () => Promise<void>;
  onRefreshSkills: () => void;
  onApplySkill: (skillId: string) => void;
  // Group chat creation — when user starts a group chat, parent page
  // creates a new chat with the given groupId.
  onStartGroupChat: (groupId: string) => void;
}

export function ChatContainer(props: ChatContainerProps) {
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const streaming = useChatStore((s) => s.streaming);
  const { toast } = useToast();
  const [canvasOpen, setCanvasOpen] = React.useState(false);
  const [integrationsOpen, setIntegrationsOpen] = React.useState(false);
  const [exportsOpen, setExportsOpen] = React.useState(false);
  const [skillsOpen, setSkillsOpen] = React.useState(false);
  const [logsOpen, setLogsOpen] = React.useState(false);
  const [themesOpen, setThemesOpen] = React.useState(false);
  const [groupsOpen, setGroupsOpen] = React.useState(false);
  const [billingOpen, setBillingOpen] = React.useState(false);
  const [attachments, setAttachments] = React.useState<File[]>([]);
  const [canvasState, setCanvasState] = React.useState<CanvasState | null>(null);
  const [canvasHistory, setCanvasHistory] = React.useState<CanvasState["history"]>([]);
  const [dashboardData, setDashboardData] = React.useState<DashboardData | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Expose openers for command palette
  React.useEffect(() => {
    (window as any).__openCanvas = () => setCanvasOpen(true);
    (window as any).__openIntegrations = () => setIntegrationsOpen(true);
    (window as any).__openExports = () => setExportsOpen(true);
    (window as any).__openSkills = () => setSkillsOpen(true);
    (window as any).__openLogs = () => setLogsOpen(true);
    (window as any).__openThemes = () => setThemesOpen(true);
    (window as any).__openGroups = () => setGroupsOpen(true);
    (window as any).__openBilling = () => setBillingOpen(true);
  }, []);

  // Auto-scroll on new messages
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [props.messages.length, streaming]);

  // Fetch dashboard data on open
  React.useEffect(() => {
    if (props.dashboardOpen) {
      fetch("/api/dashboard")
        .then((r) => r.json())
        .then(setDashboardData)
        .catch(() => {});
    }
  }, [props.dashboardOpen]);

  return (
    <div className="dark-bg-vignette relative h-screen w-screen overflow-hidden">
      <Sidebar
        chats={props.chats}
        activeChatId={props.activeChatId}
        onSelectChat={props.onSelectChat}
        onNewChat={props.onNewChat}
        onOpenIntegrations={() => setIntegrationsOpen(true)}
        onOpenCanvas={() => setCanvasOpen(true)}
        onOpenExports={() => setExportsOpen(true)}
        onOpenDashboard={props.onOpenDashboard}
        onOpenSkills={() => setSkillsOpen(true)}
        onOpenLogs={() => setLogsOpen(true)}
        onOpenThemes={() => setThemesOpen(true)}
        onOpenGroups={() => setGroupsOpen(true)}
        onOpenBilling={() => setBillingOpen(true)}
        session={props.session}
        onRenameChat={props.onRenameChat}
        onDeleteChat={props.onDeleteChat}
        onTogglePin={props.onTogglePin}
      />

      <div
        className={cn(
          "flex h-full flex-col transition-[padding] duration-300 ease-out",
          sidebarOpen ? "pl-72" : "pl-0"
        )}
      >
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-sm font-semibold tracking-tight truncate">
              {props.activeChatTitle || "New chat"}
            </h1>
            <IntentDriftBadge state={props.distillation} />
          </div>
          <div className="flex items-center gap-1">
            <ModePicker
              mode={props.mode}
              fullBuildOnly={props.fullBuildOnly}
              onModeChange={props.onModeChange}
              onFullBuildOnlyChange={props.onFullBuildOnlyChange}
              disabled={streaming}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCanvasOpen(true)}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <CanvasGlyph />
              <span className="hidden sm:inline">Canvas</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={props.onOpenPalette}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
              title="Command palette (Cmd+K)"
            >
              <CommandIcon />
              <span className="hidden md:inline">⌘K</span>
            </Button>
            <ThemeToggle />
            <AccountMenu session={props.session} />
          </div>
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {props.messages.length === 0 ? (
            <EmptyState onPrompt={(p) => props.onSend(p, [])} />
          ) : (
            <div className="pb-6">
              {props.messages.map((m) => (
                <ChatMessage key={m.id} message={m} />
              ))}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="shrink-0">
          <Composer
            onSend={props.onSend}
            disabled={streaming}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
          />
        </div>
      </div>

      {/* Canvas */}
      <CanvasPanel
        open={canvasOpen}
        onOpenChange={setCanvasOpen}
        state={canvasState}
        onStateChange={(s) => {
          setCanvasState(s);
          setCanvasHistory((h) => [
            ...h,
            { id: crypto.randomUUID(), kind: s.kind, source: s.source, createdAt: new Date().toISOString() },
          ]);
        }}
        onBack={() => {
          if (canvasHistory.length < 2) return;
          const prev = canvasHistory[canvasHistory.length - 2];
          setCanvasState({ kind: prev.kind, source: prev.source, history: canvasHistory.slice(0, -1) });
          setCanvasHistory((h) => h.slice(0, -1));
        }}
        canGoBack={canvasHistory.length > 1}
        chatId={props.activeChatId}
        onToast={(msg) => toast({ title: msg })}
      />

      {/* Integrations */}
      <IntegrationsPanel
        open={integrationsOpen}
        onOpenChange={setIntegrationsOpen}
        integrations={props.integrations}
        onSave={props.onSaveIntegration}
        onToggle={props.onToggleIntegration}
      />

      {/* Exports */}
      <ExportsDialog
        open={exportsOpen}
        onOpenChange={setExportsOpen}
        onRaw={props.onExportRaw}
        onAggregate={props.onExportAggregate}
      />

      {/* Dashboard */}
      <DashboardPanel
        open={props.dashboardOpen}
        onOpenChange={props.onDashboardOpenChange}
        data={dashboardData}
      />

      {/* Skills */}
      <SkillsPanel
        open={skillsOpen}
        onOpenChange={setSkillsOpen}
        skills={props.skills}
        onRefresh={props.onRefreshSkills}
        onApply={(id) => {
          props.onApplySkill(id);
          setSkillsOpen(false);
        }}
      />

      {/* Audit logs */}
      <LogsPanel open={logsOpen} onOpenChange={setLogsOpen} />

      {/* Theme switcher */}
      <ThemeSwitcher open={themesOpen} onOpenChange={setThemesOpen} />

      {/* Groups */}
      <GroupsPanel
        open={groupsOpen}
        onOpenChange={setGroupsOpen}
        onStartGroupChat={props.onStartGroupChat}
      />

      {/* Billing */}
      <BillingPanel
        open={billingOpen}
        onOpenChange={setBillingOpen}
        billingConfigured={props.session?.billingConfigured ?? false}
      />

      {/* Command palette */}
      <CommandPalette
        open={props.paletteOpen}
        onOpenChange={(v) => {
          if (!v) {
            // Close — dispatch event the page-level listener catches
            window.dispatchEvent(new CustomEvent("palette-close"));
          }
        }}
        actions={props.paletteActions}
      />
    </div>
  );
}

function EmptyState({ onPrompt }: { onPrompt: (text: string) => void }) {
  const prompts = [
    "Build me a React component for a glassmorphic settings panel",
    "Explain how turn-by-turn JSON logging works in this app",
    "Write a deploy script for Railway with Postgres",
    "Search CourtListener for recent First Amendment cases",
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-foreground text-background">
        <SparkBig />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight text-gradient-bold">
        Peak reasoning. Full tokens. No kick-down.
      </h2>
      <p className="mt-2 max-w-md text-center text-sm text-muted-foreground">
        GLM 5.2 is wired. Try a prompt, or press <kbd className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] font-mono">⌘K</kbd> for commands.
      </p>
      <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
        {prompts.map((p) => (
          <button
            key={p}
            onClick={() => onPrompt(p)}
            className="glass-panel rounded-xl px-4 py-3 text-left text-sm text-muted-foreground hover:text-foreground press-smooth"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function AccountMenu({ session }: { session: SessionInfo | null }) {
  const user = session?.user;
  const displayName = user?.name ?? user?.email ?? "Not signed in";
  const displayEmail = user?.email ?? "";
  const initials = (user?.name ?? user?.email ?? "?")
    .split(/[\s@.]+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("") || "?";

  async function handleSignOut() {
    // next-auth/client signOut clears the JWT cookie and redirects.
    const { signOut } = await import("next-auth/react");
    await signOut({ callbackUrl: "/signin" });
  }

  async function handleSignIn() {
    window.location.href = "/signin";
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-9 w-9 items-center justify-center rounded-lg glass text-xs font-semibold uppercase press-smooth">
          {user ? initials : <UserGlyph />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-3 py-2">
          <div className="text-sm font-medium truncate">{displayName}</div>
          {displayEmail && (
            <div className="text-xs text-muted-foreground truncate">{displayEmail}</div>
          )}
          {session?.demoMode && (
            <div className="mt-1 inline-block rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-500">
              Demo mode
            </div>
          )}
        </div>
        {user ? (
          <>
            <DropdownMenuItem onClick={() => { window.location.href = "/settings"; }}>
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleSignOut} className="text-red-500 focus:text-red-500">
              Sign out
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onClick={handleSignIn}>Sign in</DropdownMenuItem>
            <DropdownMenuItem onClick={() => { window.location.href = "/signup"; }}>
              Create account
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ExportsDialog({
  open,
  onOpenChange,
  onRaw,
  onAggregate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onRaw: () => Promise<void>;
  onAggregate: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const { toast } = useToast();

  async function run(kind: "raw" | "agg", fn: () => Promise<void>) {
    setBusy(kind);
    try {
      await fn();
      toast({ title: "Export ready", description: "Download started." });
    } catch (e) {
      toast({ title: "Export failed", description: String(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Memory & exports</DialogTitle>
          <DialogDescription className="text-xs">
            Every turn in this chat is already JSON-logged. Pick what to export.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <button
            onClick={() => run("agg", onAggregate)}
            disabled={!!busy}
            className="glass w-full rounded-xl p-4 text-left press-smooth disabled:opacity-50"
          >
            <div className="flex items-center gap-2">
              <SparkSmall />
              <span className="text-sm font-semibold">Deep Aggregate Export</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Extracts facts, entities, decisions, action items, open questions. Structured JSON.
            </p>
            <div className="mt-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {busy === "agg" ? "Extracting…" : "Recommended"}
            </div>
          </button>

          <button
            onClick={() => run("raw", onRaw)}
            disabled={!!busy}
            className="glass w-full rounded-xl p-4 text-left press-smooth disabled:opacity-50"
          >
            <div className="flex items-center gap-2">
              <FileGlyph />
              <span className="text-sm font-semibold">Raw Chat Export</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Every message verbatim. JSON array, includes token counts and attachments.
            </p>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ----- SVG glyphs ----------------------------------------------------

function SparkBig() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 L13.5 10.5 L21 12 L13.5 13.5 L12 21 L10.5 13.5 L3 12 L10.5 10.5 Z" />
    </svg>
  );
}

function SparkSmall() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 L13.5 10.5 L21 12 L13.5 13.5 L12 21 L10.5 13.5 L3 12 L10.5 10.5 Z" />
    </svg>
  );
}

function UserGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function CanvasGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="M2 2l7.586 7.586" />
      <circle cx="11" cy="11" r="2" />
    </svg>
  );
}

function CommandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
    </svg>
  );
}

function FileGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
