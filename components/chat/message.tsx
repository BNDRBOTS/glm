"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

export interface ChatMessageProps {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model?: string;
  streaming?: boolean;
  tokens?: number;
  createdAt: string;
  // Optional attachments (rendered above content)
  attachments?: { filename: string; mimeType: string; size: number }[];
}

export function ChatMessage({ message }: { message: ChatMessageProps }) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  return (
    <div
      className={cn(
        "group w-full px-4 sm:px-6 press-smooth",
        isUser ? "py-3" : "py-5"
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full max-w-3xl gap-3 sm:gap-4",
          isUser ? "flex-row-reverse" : "flex-row"
        )}
      >
        {/* Avatar */}
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold uppercase tracking-wider",
            isUser
              ? "glass text-foreground"
              : "bg-foreground text-background"
          )}
          aria-hidden
        >
          {isUser ? (
            <UserGlyph />
          ) : (
            <SparkGlyph />
          )}
        </div>

        {/* Body */}
        <div
          className={cn(
            "min-w-0 flex-1 space-y-2",
            isUser ? "items-end text-right" : "items-start text-left"
          )}
        >
          {message.model && isAssistant && (
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {message.model}
            </div>
          )}

          {message.attachments && message.attachments.length > 0 && (
            <div className={cn("flex flex-wrap gap-2", isUser && "justify-end")}>
              {message.attachments.map((a, i) => (
                <div
                  key={i}
                  className="glass flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs"
                >
                  <FileGlyph />
                  <span className="font-medium">{a.filename}</span>
                  <span className="text-muted-foreground">
                    {(a.size / 1024).toFixed(1)} KB
                  </span>
                </div>
              ))}
            </div>
          )}

          <div
            className={cn(
              "inline-block max-w-full rounded-2xl px-4 py-3 text-[15px] leading-relaxed",
              isUser
                ? "glass text-foreground"
                : "text-foreground"
            )}
          >
            <MarkdownRenderer
              content={message.content}
              streaming={message.streaming}
            />
          </div>

          {message.tokens != null && !message.streaming && (
            <div className="text-[10px] text-muted-foreground">
              {message.tokens} tokens
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MarkdownRenderer({
  content,
  streaming,
}: {
  content: string;
  streaming?: boolean;
}) {
  return (
    <div className={cn("prose-chat", streaming && "stream-caret")}>
      <ReactMarkdown
        components={{
          code({ node, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const isInline = !match && !String(children).includes("\n");
            if (isInline) {
              return (
                <code
                  className="rounded bg-foreground/10 px-1.5 py-0.5 font-mono text-[13px]"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <div className="my-3 overflow-hidden rounded-xl border border-border">
                <div className="flex items-center justify-between border-b border-border bg-foreground/5 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  <span>{match?.[1] ?? "code"}</span>
                </div>
                <SyntaxHighlighter
                  language={match?.[1] ?? "text"}
                  style={oneDark}
                  customStyle={{
                    margin: 0,
                    background: "transparent",
                    fontSize: "13px",
                    padding: "14px",
                  }}
                  codeTagProps={{ style: { fontFamily: "var(--font-geist-mono), monospace" } }}
                >
                  {String(children).replace(/\n$/, "")}
                </SyntaxHighlighter>
              </div>
            );
          },
          p({ children }) {
            return <p className="mb-3 last:mb-0">{children}</p>;
          },
          ul({ children }) {
            return <ul className="mb-3 ml-5 list-disc space-y-1">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="mb-3 ml-5 list-decimal space-y-1">{children}</ol>;
          },
          h1({ children }) {
            return <h1 className="mb-3 text-xl font-semibold">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="mb-2 text-lg font-semibold">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="mb-2 text-base font-semibold">{children}</h3>;
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-2 hover:opacity-70"
              >
                {children}
              </a>
            );
          },
          blockquote({ children }) {
            return (
              <blockquote className="my-3 border-l-2 border-foreground/30 pl-4 italic text-muted-foreground">
                {children}
              </blockquote>
            );
          },
          table({ children }) {
            return (
              <div className="my-3 overflow-x-auto">
                <table className="w-full border-collapse text-sm">{children}</table>
              </div>
            );
          },
          th({ children }) {
            return <th className="border border-border px-3 py-1.5 text-left font-semibold">{children}</th>;
          },
          td({ children }) {
            return <td className="border border-border px-3 py-1.5">{children}</td>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ----- SVG glyphs (no emojis) ----------------------------------------

function UserGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function SparkGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 L13.5 10.5 L21 12 L13.5 13.5 L12 21 L10.5 13.5 L3 12 L10.5 10.5 Z" />
    </svg>
  );
}

function FileGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
