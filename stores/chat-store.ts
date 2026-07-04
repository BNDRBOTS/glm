/**
 * Chat UI state store. Client-side only.
 * Manages: selected model, streaming flag, sidebar open/closed.
 * Server-truth (messages, chats) lives in the DB + page.tsx local state.
 */

"use client";

import { create } from "zustand";

interface ChatState {
  streaming: boolean;
  model: string;
  sidebarOpen: boolean;
  setModel: (m: string) => void;
  setSidebar: (open: boolean) => void;
  setStreaming: (s: boolean) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  streaming: false,
  model: "glm-5.2",
  sidebarOpen: true,

  setModel: (m) => set({ model: m }),
  setSidebar: (open) => set({ sidebarOpen: open }),
  setStreaming: (streaming) => set({ streaming }),
}));
