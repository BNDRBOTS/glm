"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface SidebarChat {
  id: string;
  title: string;
  updatedAt: string;
  pinned?: boolean;
}

interface SessionInfo {
  user: { id: string; email: string; name: string | null; role: string } | null;
  demoMode: boolean;
  glmConfigured: boolean;
  voiceConfigured: boolean;
  billingConfigured: boolean;
}

export interface SidebarProps {
  chats: SidebarChat[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onOpenIntegrations: () => void;
  onOpenCanvas: () => void;
  onOpenExports: () => void;
  onOpenDashboard: () => void;
  onOpenSkills: () => void;
  onOpenLogs: () => void;
  onOpenThemes: () => void;
  onOpenGroups: () => void;
  onOpenBilling: () => void;
  session: SessionInfo | null;
  onRenameChat: (id: string, title: string) => void;
  onDeleteChat: (id: string) => void;
  onTogglePin: (id: string) => void;
}

export function Sidebar({
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onOpenIntegrations,
  onOpenCanvas,
  onOpenExports,
  onOpenDashboard,
  onOpenSkills,
  onOpenLogs,
  onOpenThemes,
  onOpenGroups,
  onOpenBilling,
  session,
  onRenameChat,
  onDeleteChat,
  onTogglePin,
}: SidebarProps) {
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const setSidebar = useChatStore((s) => s.setSidebar);
  const [renameTarget, setRenameTarget] = React.useState<SidebarChat | null>(null);
  const [renameValue, setRenameValue] = React.useState("");

  if (!sidebarOpen) {
    return (
      <button
        onClick={() => setSidebar(true)}
        className="fixed left-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-lg glass text-muted-foreground hover:text-foreground press-smooth"
        aria-label="Open sidebar"
      >
        <PanelLeftIcon />
      </button>
    );
  }

  // Pinned chats first, then by updatedAt desc (callers already sort by
  // updatedAt; we just bubble pinned ones to the top here).
  const sortedChats = [...chats].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  function handleRenameSubmit() {
    if (!renameTarget) return;
    const title = renameValue.trim();
    if (title) onRenameChat(renameTarget.id, title);
    setRenameTarget(null);
    setRenameValue("");
  }

  return (
    <aside className="glass-panel fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-border">
      {/* Brand + collapse */}
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <BrandMark />
          <div className="flex flex-col leading-none">
            <span className="text-[13px] font-semibold tracking-tight">GLM Power</span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Peak Tier
            </span>
          </div>
        </div>
        <button
          onClick={() => setSidebar(false)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground press-smooth"
          aria-label="Collapse sidebar"
        >
          <CloseIcon />
        </button>
      </div>

      {/* New chat */}
      <div className="px-3 pb-2">
        <Button
          onClick={onNewChat}
          className="w-full justify-start gap-2 rounded-xl bg-foreground text-background hover:bg-foreground/85"
        >
          <PlusIcon />
          <span>New chat</span>
        </Button>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="px-2 pb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Recent
        </div>
        {sortedChats.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No chats yet. Start one.
          </div>
        ) : (
          <ul className="space-y-0.5">
            {sortedChats.map((c) => (
              <li key={c.id} className="group relative">
                <button
                  onClick={() => onSelectChat(c.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm press-smooth",
                    activeChatId === c.id
                      ? "glass text-foreground"
                      : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  )}
                >
                  <ChatIcon />
                  <span className="flex-1 truncate">{c.title}</span>
                  {c.pinned && <PinIcon />}
                </button>
                {/* Hover actions */}
                <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        onClick={(e) => e.stopPropagation()}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground press-smooth"
                        aria-label="Chat actions"
                      >
                        <MoreIcon />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuItem onClick={() => onTogglePin(c.id)}>
                        {c.pinned ? "Unpin" : "Pin"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setRenameTarget(c);
                          setRenameValue(c.title);
                        }}
                      >
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-red-500 focus:text-red-500"
                        onClick={() => {
                          if (confirm(`Delete "${c.title}"? This cannot be undone.`)) {
                            onDeleteChat(c.id);
                          }
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Tools */}
      <div className="border-t border-border p-2">
        <div className="space-y-0.5">
          <SidebarToolButton onClick={onOpenCanvas} icon={<CanvasIcon />} label="Code canvas" />
          <SidebarToolButton onClick={onOpenIntegrations} icon={<PlugIcon />} label="Connectors" />
          <SidebarToolButton onClick={onOpenSkills} icon={<SkillIcon />} label="Skills" />
          <SidebarToolButton onClick={onOpenGroups} icon={<GroupsIcon />} label="Groups" />
          <SidebarToolButton onClick={onOpenDashboard} icon={<ChartIcon />} label="Token dashboard" />
          <SidebarToolButton onClick={onOpenBilling} icon={<BillingIcon />} label="Billing" />
          <SidebarToolButton onClick={onOpenLogs} icon={<LogsIcon />} label="Audit log" />
          <SidebarToolButton onClick={onOpenThemes} icon={<PaletteIcon />} label="Theme" />
          <SidebarToolButton onClick={onOpenExports} icon={<DownloadIcon />} label="Memory & exports" />
        </div>
      </div>

      {/* Footer — replaces hardcoded "API key detected" with real state */}
      <div className="flex h-12 items-center justify-between border-t border-border px-3">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {session?.glmConfigured ? (
            <>
              <div className="h-2 w-2 rounded-full bg-emerald-500/80" />
              <span>API key detected</span>
            </>
          ) : (
            <>
              <div className="h-2 w-2 rounded-full bg-amber-500/80" />
              <span>No API key</span>
            </>
          )}
        </div>
        <ThemeToggle />
      </div>

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(v) => !v && setRenameTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
            <DialogDescription className="text-xs">
              Change the title shown in the sidebar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-input" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Title
            </Label>
            <Input
              id="rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameSubmit();
              }}
              autoFocus
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setRenameTarget(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleRenameSubmit}>
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

function SidebarToolButton({
  onClick,
  icon,
  label,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground hover:bg-foreground/5 hover:text-foreground press-smooth"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ----- SVG icons -----------------------------------------------------

function BrandMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 64 64" fill="none">
      <rect width="64" height="64" rx="14" fill="currentColor" />
      <path d="M16 22 L32 14 L48 22 L48 42 L32 50 L16 42 Z" stroke="#fff" strokeWidth="2.5" strokeLinejoin="round" fill="none" />
      <circle cx="32" cy="32" r="6" fill="#fff" />
    </svg>
  );
}

function PanelLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17v5M9 10.76V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4.76a2 2 0 0 0 .79 1.6L18 14H6l2.21-1.65a2 2 0 0 0 .79-1.59z" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  );
}

function CanvasIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="M2 2l7.586 7.586" />
      <circle cx="11" cy="11" r="2" />
    </svg>
  );
}

function PlugIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22v-5" />
      <path d="M9 7V2" />
      <path d="M15 7V2" />
      <path d="M6 13V8h12v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <rect x="7" y="10" width="3" height="8" />
      <rect x="12" y="6" width="3" height="12" />
      <rect x="17" y="13" width="3" height="5" />
    </svg>
  );
}

function SkillIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 L19 6 L19 14 L12 18 L5 14 L5 6 Z" />
      <path d="M12 2 L12 18 M5 6 L19 14 M19 6 L5 14" strokeOpacity="0.4" />
    </svg>
  );
}

function LogsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}

function GroupsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function BillingIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  );
}
