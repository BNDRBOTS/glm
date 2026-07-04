"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { MODELS } from "@/lib/ai/models";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface ComposerProps {
  onSend: (text: string, files: File[]) => void;
  disabled?: boolean;
  attachments: File[];
  onAttachmentsChange: (files: File[]) => void;
}

export function Composer({ onSend, disabled, attachments, onAttachmentsChange }: ComposerProps) {
  const [text, setText] = React.useState("");
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const model = useChatStore((s) => s.model);
  const setModel = useChatStore((s) => s.setModel);
  const recorder = useVoiceRecorder();
  const { toast } = useToast();

  // Auto-grow
  React.useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = Math.min(ta.scrollHeight, 220) + "px";
  }, [text]);

  // Show recorder errors as toasts
  React.useEffect(() => {
    if (recorder.error) {
      toast({ title: "Voice input error", description: recorder.error, variant: "destructive" });
    }
  }, [recorder.error, toast]);

  async function handleMicClick() {
    if (recorder.isRecording) {
      const blob = await recorder.stop();
      if (!blob) {
        recorder.cancel();
        return;
      }
      // Transcribe
      try {
        const form = new FormData();
        form.append("file", blob, "audio.webm");
        form.append("provider", "zai");
        const r = await fetch("/api/voice/transcribe", { method: "POST", body: form });
        const j = await r.json();
        if (!r.ok) {
          toast({ title: "Transcription failed", description: j.error, variant: "destructive" });
          return;
        }
        if (j.text) {
          setText((prev) => (prev ? prev + " " + j.text : j.text));
          toast({
            title: "Transcribed",
            description: `${j.provider} · ${(blob.size / 1024).toFixed(1)} KB → ${j.text.length} chars`,
          });
        }
      } catch (e) {
        toast({ title: "Transcription failed", description: String(e), variant: "destructive" });
      } finally {
        recorder.cancel();
      }
    } else {
      await recorder.start();
    }
  }

  function handleSend() {
    if ((!text.trim() && attachments.length === 0) || disabled) return;
    onSend(text.trim(), attachments);
    setText("");
    onAttachmentsChange([]);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    onAttachmentsChange([...attachments, ...files]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function removeAttachment(idx: number) {
    onAttachmentsChange(attachments.filter((_, i) => i !== idx));
  }

  return (
    <div className="px-3 pb-4 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((f, i) => (
              <div
                key={i}
                className="glass flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs press-smooth"
              >
                <FileIcon />
                <span className="font-medium">{f.name}</span>
                <span className="text-muted-foreground">{(f.size / 1024).toFixed(1)} KB</span>
                <button
                  onClick={() => removeAttachment(i)}
                  className="ml-1 text-muted-foreground hover:text-foreground"
                  aria-label="Remove attachment"
                >
                  <CloseIcon />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="glass-strong overflow-hidden rounded-2xl">
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={disabled}
            rows={1}
            placeholder="Message GLM 5.2…"
            className="block w-full resize-none bg-transparent px-4 py-3.5 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-50"
          />

          <div className="flex items-center justify-between gap-2 px-2 py-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground press-smooth"
                aria-label="Upload file"
                title="Upload file"
              >
                <PaperclipIcon />
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFiles}
              />

              <button
                type="button"
                onClick={handleMicClick}
                disabled={disabled || recorder.isTranscribing}
                className={cn(
                  "relative flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium press-smooth disabled:opacity-50",
                  recorder.isRecording
                    ? "bg-red-500/15 text-red-500"
                    : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                )}
                aria-label={recorder.isRecording ? "Stop recording" : "Start voice input"}
                title={recorder.isRecording ? `Recording… ${recorder.seconds}s` : "Voice input (Z.ai ASR)"}
              >
                {recorder.isRecording ? (
                  <>
                    <span className="absolute left-2 h-2 w-2 animate-pulse rounded-full bg-red-500" />
                    <span className="ml-4 tabular-nums">{recorder.seconds}s</span>
                    <StopIcon />
                  </>
                ) : recorder.isTranscribing ? (
                  <>
                    <SpinnerIcon />
                    <span className="hidden sm:inline">Transcribing…</span>
                  </>
                ) : (
                  <>
                    <MicIcon />
                    <span className="hidden sm:inline">Voice</span>
                  </>
                )}
              </button>

              <ModelPicker model={model} setModel={setModel} disabled={disabled} />
            </div>

            <button
              type="button"
              onClick={handleSend}
              disabled={disabled || (!text.trim() && attachments.length === 0)}
              className={cn(
                "flex h-9 items-center gap-2 rounded-lg px-3.5 text-[13px] font-medium press-smooth",
                "bg-foreground text-background hover:opacity-80",
                "disabled:cursor-not-allowed disabled:opacity-30"
              )}
            >
              <span className="hidden sm:inline">Send</span>
              <ArrowUpIcon />
            </button>
          </div>
        </div>

        <div className="mt-2 text-center text-[10px] text-muted-foreground">
          GLM 5.2 peak reasoning · Enter to send · Shift+Enter for newline
        </div>
      </div>
    </div>
  );
}

function ModelPicker({
  model,
  setModel,
  disabled,
}: {
  model: string;
  setModel: (m: string) => void;
  disabled?: boolean;
}) {
  const active = MODELS.find((m) => m.id === model) ?? MODELS[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium text-muted-foreground hover:bg-foreground/5 hover:text-foreground press-smooth disabled:opacity-50"
        >
          <TierDot tier={active.tier} />
          <span>{active.label}</span>
          <ChevronDownIcon />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Model
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {MODELS.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onClick={() => setModel(m.id)}
            className="flex flex-col items-start gap-1 py-2"
          >
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center gap-2">
                <TierDot tier={m.tier} />
                <span className="font-medium">{m.label}</span>
              </div>
              {m.id === model && <CheckIcon />}
            </div>
            <p className="pl-5 text-xs text-muted-foreground">{m.description}</p>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TierDot({ tier }: { tier: "peak" | "fast" | "fastest" }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        tier === "peak" && "bg-foreground",
        tier === "fast" && "bg-foreground/50",
        tier === "fastest" && "bg-foreground/25"
      )}
    />
  );
}

// ----- SVG icons -----------------------------------------------------

function PaperclipIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
