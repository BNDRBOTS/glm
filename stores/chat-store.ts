/**
 * Chat UI state store. Client-side only.
 * Manages: selected model, streaming flag, sidebar open/closed, and
 * the RAG toggle (answer-from-documents). Server-truth (messages,
 * chats, documents) lives in the DB + page.tsx local state.
 */

"use client";

import { create } from "zustand";

interface ChatState {
  streaming: boolean;
  model: string;
  sidebarOpen: boolean;
  // RAG on by default — retrieval no-ops instantly when the user has
  // no indexed documents, so the default costs nothing.
  ragEnabled: boolean;
  setModel: (m: string) => void;
  setSidebar: (open: boolean) => void;
  setStreaming: (s: boolean) => void;
  setRagEnabled: (v: boolean) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  streaming: false,
  model: "glm-5.2",
  sidebarOpen: true,
  ragEnabled: true,

  setModel: (m) => set({ model: m }),
  setSidebar: (open) => set({ sidebarOpen: open }),
  setStreaming: (streaming) => set({ streaming }),
  setRagEnabled: (ragEnabled) => set({ ragEnabled }),
}));
