"use client";

/**
 * Documents panel — RAG library (merged from ragdb).
 * ---------------------------------------------------------------------
 * Upload zone (drag & drop or browse) + document list with ingest
 * status, chunk counts, and delete. Self-fetching like LogsPanel.
 * Accepted formats + 50 MB cap mirror the server exactly, so the
 * user gets instant validation feedback before any bytes move.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

export interface DocumentRow {
  id: string;
  title: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  status: "processing" | "ready" | "error";
  error: string | null;
  chunkCount: number;
  embeddingProvider: string;
  createdAt: string;
}

const ACCEPTED_EXTENSIONS = ".pdf,.txt,.md,.docx,.xlsx";
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const ALLOWED_EXT = new Set(["pdf", "txt", "md", "markdown", "docx", "xlsx"]);

function isAccepted(file: File): boolean {
  if (ALLOWED_MIME.has(file.type)) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ALLOWED_EXT.has(ext);
}

export function DocumentsPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [documents, setDocuments] = React.useState<DocumentRow[]>([]);
  // Starts true so the first open paints "Loading…" — refresh() never
  // sets it synchronously (react-hooks/set-state-in-effect).
  const [loading, setLoading] = React.useState(true);
  const [uploading, setUploading] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const refresh = React.useCallback(async () => {
    try {
      const r = await fetch("/api/documents");
      if (!r.ok) return;
      const j = await r.json();
      if (Array.isArray(j.documents)) setDocuments(j.documents);
    } catch {
      // panel shows previous state
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  async function handleUpload(file: File) {
    if (!isAccepted(file)) {
      toast({
        title: "Unsupported file type",
        description: "Allowed: PDF, TXT, MD, DOCX, XLSX",
        variant: "destructive",
      });
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast({ title: "File exceeds 50 MB limit", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/documents", { method: "POST", body: form });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast({ title: "Ingest failed", description: j.error ?? `HTTP ${r.status}`, variant: "destructive" });
      } else {
        toast({
          title: "Document indexed",
          description: `${j.title} · ${j.chunkCount} chunks · ${j.embeddingProvider} embeddings`,
        });
      }
      await refresh();
    } catch (e) {
      toast({ title: "Upload failed", description: String(e), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(doc: DocumentRow) {
    if (!confirm(`Delete "${doc.title}" and its index? This cannot be undone.`)) return;
    try {
      const r = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast({ title: "Delete failed", description: j.error ?? `HTTP ${r.status}`, variant: "destructive" });
        return;
      }
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      toast({ title: "Document deleted" });
    } catch (e) {
      toast({ title: "Delete failed", description: String(e), variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Documents</DialogTitle>
          <DialogDescription className="text-xs">
            Upload documents and chat against them. Files are parsed, chunked, embedded, and
            indexed — every RAG-enabled turn cites its sources.
          </DialogDescription>
        </DialogHeader>

        {/* Upload zone */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload document"
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) handleUpload(file);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onClick={() => !uploading && inputRef.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
          className={cn(
            "glass cursor-pointer rounded-xl border-2 border-dashed px-6 py-8 text-center press-smooth",
            dragging ? "border-foreground/60" : "border-border hover:border-foreground/40",
            uploading && "pointer-events-none opacity-50"
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
              e.target.value = "";
            }}
            disabled={uploading}
            className="sr-only"
            aria-hidden="true"
          />
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center text-muted-foreground">
            {uploading ? <SpinnerIcon /> : <UploadIcon />}
          </div>
          <p className="text-sm font-medium">
            {uploading ? "Parsing, chunking, embedding…" : "Drop a file or click to browse"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">PDF, TXT, MD, DOCX, XLSX · Max 50 MB</p>
        </div>

        {/* Document list */}
        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {loading && documents.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">Loading…</div>
          ) : documents.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              No documents yet. Upload one to start chatting with your files.
            </div>
          ) : (
            documents.map((d) => (
              <div key={d.id} className="glass flex items-center gap-3 rounded-xl px-3 py-2.5">
                <StatusDot status={d.status} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{d.title}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {formatSize(d.fileSize)}
                    {d.status === "ready" && ` · ${d.chunkCount} chunks · ${d.embeddingProvider}`}
                    {d.status === "processing" && " · processing…"}
                    {d.status === "error" && ` · ${d.error ?? "ingest failed"}`}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(d)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/10 hover:text-red-500 press-smooth"
                  aria-label={`Delete ${d.title}`}
                  title="Delete document"
                >
                  <TrashIcon />
                </button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusDot({ status }: { status: DocumentRow["status"] }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        status === "ready" && "bg-emerald-500",
        status === "processing" && "animate-pulse bg-amber-500",
        status === "error" && "bg-red-500"
      )}
      aria-label={status}
    />
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ----- SVG glyphs (no emojis) ------------------------------------------

function UploadIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" x2="12" y1="3" y2="15" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
