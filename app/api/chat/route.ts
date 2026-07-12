/**
 * POST /api/chat
 * ---------------------------------------------------------------------
 * Streaming chat completion. Server-side only.
 *
 * Pipeline:
 *   1. Auth check (or demo mode if explicitly enabled)
 *   2. Persist user message + log turn to MemoryLog
 *   3. Run distillation on user message (update intent state)
 *   3b. RAG retrieval (merged from ragdb): similarity search over the
 *       user's indexed documents; matches injected as numbered
 *       [Source N] excerpts in the system prefix, source metadata
 *       streamed to the client + persisted with the assistant turn.
 *   4. Stream model response token-by-token (GLM or DeepSeek —
 *      reasoning tokens stream separately as `thinking` events)
 *   5. Silent quality checker runs on full output
 *      - If slop detected and fullBuildOnly: retry with feedback
 *      - If intent drift: retry with intent feedback
 *   6. Mode gate decides: deliver / require-plan-approval / require-edit-approval
 *   7. Persist final assistant message + log turn
 *   8. Record usage
 *
 * Abort handling: if client disconnects, stream is cancelled.
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getGLMClient, type ChatTurn } from "@/lib/ai/client";
import { logTurn } from "@/lib/memory";
import { getCurrentUserId } from "@/lib/auth/nextauth";
import { isDemoModeAllowed, DEMO_USER_ID } from "@/lib/auth/require-user";
import { parseMode, modeGate, type ChatMode } from "@/lib/permissions/modes";
import { checkAndRetry } from "@/lib/quality/checker";
import { initState, distillTurn, type DistillationState } from "@/lib/distillation";
import { getDistillationState, setDistillationState } from "@/lib/distillation/state";
import { logAudit } from "@/lib/audit";
import { storeAttachment } from "@/lib/storage/attachments";
import {
  parseToolCalls,
  executeToolCall,
  buildToolCallSystemPrefix,
} from "@/lib/tools/connector-calls";
import { listConnectors } from "@/lib/connectors/registry";
import { buildRagContext } from "@/lib/rag/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Long streams + large retrieval contexts (ported from ragdb).
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  const enableDemo = isDemoModeAllowed();

  // SECURITY: only allow demo-user fallback when explicitly enabled
  if (!userId && !enableDemo) {
    return new Response(
      JSON.stringify({ error: "Not authenticated. Set ENABLE_DEMO_MODE=1 in dev, or sign in." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const body = await req.json();
  const { chatId, model, text, mode, fullBuildOnly, skillId, attachments, groupId, ragEnabled } = body as {
    chatId?: string;
    model?: string;
    text: string;
    mode?: ChatMode;
    fullBuildOnly?: boolean;
    skillId?: string;
    attachments?: { filename: string; mimeType: string; data: string }[];
    groupId?: string;
    // RAG is on by default — retrieval no-ops instantly when the user
    // has no indexed documents. Pass false to answer without documents.
    ragEnabled?: boolean;
  };

  if (!text || typeof text !== "string") {
    return new Response(JSON.stringify({ error: "Missing text" }), { status: 400 });
  }

  // Cap attachment count + total size to prevent abuse.
  const MAX_ATTACHMENTS = 10;
  const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB per file
  if (attachments && attachments.length > MAX_ATTACHMENTS) {
    return new Response(
      JSON.stringify({ error: `Too many attachments (max ${MAX_ATTACHMENTS})` }),
      { status: 413 }
    );
  }

  const effectiveUserId = userId ?? DEMO_USER_ID;
  const effectiveModel = model ?? "glm-5.2";
  const chatMode = parseMode(mode);
  const isFullBuildOnly = fullBuildOnly ?? false;

  // If a skill is active, load it and apply its settings
  let skillSystemPrompt: string | null = null;
  let skillAllowedConnectors: string[] | null = null;
  if (skillId) {
    const { getSkill } = await import("@/lib/skills");
    const skill = await getSkill(effectiveUserId, skillId);
    if (skill && skill.enabled) {
      skillSystemPrompt = skill.systemPrompt;
      skillAllowedConnectors = skill.allowedConnectors.length > 0 ? skill.allowedConnectors : null;
      await logAudit({
        userId: effectiveUserId,
        source: "skill",
        event: "skill.applied",
        payload: { skillId: skill.id, skillName: skill.name, chatMode, fullBuildOnly: isFullBuildOnly },
      });
    }
  }

  // Build the tool-calling system prefix. Shows the AI which connectors
  // it can invoke + the fenced-block syntax. Scoped by skill
  // allowedConnectors if set.
  const allConnectors = listConnectors().map((c) => ({
    id: c.manifest.id,
    label: c.manifest.label,
    capabilities: c.manifest.capabilities as Record<string, boolean | undefined>,
  }));
  // Only surface connectors the user actually has credentials for —
  // avoids the AI calling a connector that will just fail.
  const userIntegrations = await db.integration.findMany({
    where: { userId: effectiveUserId, provider: { not: { startsWith: "backend:" } } },
    select: { provider: true },
  });
  const credentialedConnectorIds = new Set(userIntegrations.map((i) => i.provider));
  const visibleConnectors = allConnectors.filter((c) => credentialedConnectorIds.has(c.id));
  const toolCallPrefix = buildToolCallSystemPrefix(skillAllowedConnectors, visibleConnectors);

  // RAG retrieval (merged from ragdb). Runs before the stream so the
  // matched excerpts ride in the system prefix of the FIRST pass —
  // the quality checker and mode gate then operate on document-
  // grounded output. buildRagContext never throws; empty results
  // yield a null prompt and RAG becomes a no-op for this turn.
  const isRagEnabled = ragEnabled !== false;
  const ragContext = isRagEnabled
    ? await buildRagContext(effectiveUserId, text)
    : null;
  const ragSystemPrompt = ragContext?.systemPrompt ?? null;
  const ragSources = ragContext?.sources ?? [];
  if (ragContext && ragContext.sources.length > 0) {
    await logAudit({
      userId: effectiveUserId,
      source: "rag",
      event: "rag.retrieval",
      payload: {
        query: text.slice(0, 200),
        matches: ragContext.sources.length,
        driver: ragContext.driver,
        degradedToLocal: ragContext.degradedToLocal,
        topSimilarity: ragContext.sources[0]?.similarity,
      },
    });
  }

  // Combine skill system prompt + RAG context + tool-call prefix.
  const combinedSystemPrefix =
    [skillSystemPrompt, ragSystemPrompt, toolCallPrefix].filter(Boolean).join("\n\n") || null;

  // Auto-create demo user if needed (only in demo mode)
  if (!userId && enableDemo) {
    await db.user.upsert({
      where: { id: "demo-user" },
      create: {
        id: "demo-user",
        email: "demo@local",
        name: "Demo",
        passwordHash: "demo-no-auth",
        role: "OWNER",
      },
      update: {},
    });
  }

  // Find or create chat — with ownership / group-membership check.
  // Pattern: resolve `chat` exactly once (either found or created),
  // then use a const so TypeScript narrows it for all downstream code.
  let chat;
  if (chatId) {
    const found = await db.chat.findUnique({
      where: { id: chatId },
      include: {
        group: {
          select: {
            id: true,
            members: { where: { userId: effectiveUserId }, select: { userId: true } },
          },
        },
      },
    });
    if (found) {
      // Owner can always access; group members can access group chats.
      const isOwner = found.ownerId === effectiveUserId;
      const isGroupMember = found.groupId != null && found.group?.members.length === 1;
      if (!isOwner && !isGroupMember) {
        return new Response(
          JSON.stringify({ error: "Chat not found or not accessible" }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        );
      }
      chat = found;
    }
  }
  if (!chat) {
    // If groupId is provided, verify membership + set type=GROUP.
    let resolvedGroupId: string | undefined;
    let chatType: "PRIVATE" | "GROUP" = "PRIVATE";
    if (groupId) {
      const membership = await db.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: effectiveUserId } },
        select: { id: true },
      });
      if (!membership) {
        return new Response(
          JSON.stringify({ error: "You are not a member of this group" }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        );
      }
      resolvedGroupId = groupId;
      chatType = "GROUP";
    }
    chat = await db.chat.create({
      data: {
        ownerId: effectiveUserId,
        model: effectiveModel,
        title: text.slice(0, 60),
        type: chatType,
        groupId: resolvedGroupId ?? null,
        settings: JSON.stringify({ mode: chatMode, fullBuildOnly: isFullBuildOnly }),
      },
    });
  }
  // After the above, chat is guaranteed non-null. Bind to a const so
  // TS narrows it for all downstream usage.
  const activeChat = chat;

  // Persist user message
  const userMsg = await db.message.create({
    data: { chatId: activeChat.id, authorId: userId, role: "user", content: text },
  });

  // Persist attachments (if any) and link them to the user message.
  // The composer sends each as { filename, mimeType, data } where data
  // is base64-encoded. We decode + store to disk + record the row.
  if (attachments && attachments.length > 0) {
    for (const att of attachments) {
      if (!att.filename || !att.data) continue;
      let buf: Buffer;
      try {
        buf = Buffer.from(att.data, "base64");
      } catch {
        continue; // skip malformed
      }
      if (buf.length === 0 || buf.length > MAX_ATTACHMENT_BYTES) continue;
      try {
        const stored = await storeAttachment(att.filename, att.mimeType, buf);
        await db.attachment.create({
          data: {
            chatId: activeChat.id,
            messageId: userMsg.id,
            filename: stored.filename,
            mimeType: stored.mimeType,
            size: stored.size,
            storage: stored.storage,
            storageKey: stored.storageKey,
          },
        });
      } catch (e) {
        // Log but don't fail the whole turn for one bad attachment.
        await logAudit({
          userId: effectiveUserId,
          source: "system",
          level: "warn",
          event: "attachment.store_failed",
          payload: { chatId: activeChat.id, messageId: userMsg.id, filename: att.filename, error: String(e) },
        });
      }
    }
  }

  await logTurn({
    messageId: userMsg.id,
    chatId: activeChat.id,
    authorId: effectiveUserId,
    role: "user",
    content: text,
  });

  // Initialize or update distillation state. Bind to a const after the
  // if/else so the inner closures below see a narrowed (non-null) type.
  // (state.ts is now async — Redis-backed with in-memory fallback.)
  let _distillState = await getDistillationState(activeChat.id);
  if (!_distillState) {
    _distillState = initState(activeChat.id, text);
  } else {
    _distillState = distillTurn(_distillState, { id: userMsg.id, role: "user", content: text });
  }
  await setDistillationState(activeChat.id, _distillState);
  let distillState: DistillationState = _distillState;

  // Load history (turn-by-turn JSON memory)
  const priorTurns = await db.message.findMany({
    where: { chatId: activeChat.id },
    orderBy: { createdAt: "asc" },
    take: 40,
  });
  const messages: ChatTurn[] = priorTurns.map((m) => ({
    role: m.role as ChatTurn["role"],
    content: m.content,
  }));

  // Stream
  const client = getGLMClient();
  const encoder = new TextEncoder();
  const signal = req.signal;

  const stream = new ReadableStream({
    async start(controller) {
      const assistantMsg = await db.message.create({
        data: { chatId: activeChat.id, authorId: null, role: "assistant", content: "", model: effectiveModel },
      });

      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      send({ type: "start", chatId: activeChat.id, messageId: assistantMsg.id });

      // Surface RAG source citations immediately — the client renders
      // the source chips while tokens stream in.
      if (ragSources.length > 0) {
        send({ type: "sources", sources: ragSources });
      }

      // Stream first attempt
      let full = "";
      let fullThinking = "";
      let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
      let aborted = false;

      const onAbort = () => { aborted = true; };
      signal.addEventListener("abort", onAbort);

      try {
        // First pass: stream to user live
        await client.stream(
          {
            model: effectiveModel,
            messages,
            temperature: 0.7,
            systemPrefix: combinedSystemPrefix ?? undefined,
          },
          {
            onToken: (token) => {
              if (aborted) return;
              send({ type: "token", token });
            },
            onThinkingToken: (token) => {
              if (aborted) return;
              send({ type: "thinking", token });
            },
            onUsage: (u) => { usage = u; },
            onDone: (f, thinking) => {
              full = f;
              if (thinking) fullThinking = thinking;
            },
            onError: (e) => {
              send({ type: "error", error: e.message });
            },
          }
        );

        if (aborted) {
          controller.close();
          return;
        }

        // Silent quality check (only if fullBuildOnly is on OR mode requires it)
        const shouldCheck = isFullBuildOnly || chatMode !== "auto";
        if (shouldCheck) {
          const checkResult = await checkAndRetry(
            full,
            messages.map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content })),
            {
              fullBuildOnly: isFullBuildOnly,
              maxRetries: 2,
              originalIntent: distillState.originalIntent,
              retry: async (priorMsgs, feedback) => {
                send({ type: "quality-retry", feedback });
                // Append the prior assistant output + feedback as a new user turn
                const retryMsgs: ChatTurn[] = [
                  ...priorMsgs.map((m) => ({ role: m.role, content: m.content }) as ChatTurn),
                  { role: "user" as const, content: feedback },
                ];
                let retryFull = "";
                await client.stream(
                  { model: effectiveModel, messages: retryMsgs, temperature: 0.5 },
                  {
                    onToken: (t) => { if (!aborted) send({ type: "token", token: t }); },
                    onDone: (f) => { retryFull = f; },
                    onError: (e) => send({ type: "error", error: e.message }),
                  }
                );
                return retryFull;
              },
            }
          );

          full = checkResult.output;

          if (checkResult.deliveredWithWarning) {
            send({
              type: "quality-warning",
              slop: checkResult.slopDetected,
              attempts: checkResult.attempts,
            });
            await logAudit({
              userId: effectiveUserId,
              source: "quality",
              level: "warn",
              event: "slop.delivered_with_warning",
              payload: {
                chatId: activeChat.id,
                messageId: assistantMsg.id,
                slop: checkResult.slopDetected,
                attempts: checkResult.attempts,
              },
              chatId: activeChat.id,
            });
          }

          if (checkResult.attempts > 1) {
            send({
              type: "quality-retries",
              attempts: checkResult.attempts,
            });
            await logAudit({
              userId: effectiveUserId,
              source: "quality",
              event: "slop.retried",
              payload: {
                chatId: activeChat.id,
                messageId: assistantMsg.id,
                attempts: checkResult.attempts,
                passed: checkResult.passed,
              },
              chatId: activeChat.id,
            });
          }
        }

        // Tool-call loop. The AI may have emitted fenced `tool:connector:*`
        // blocks in its first pass. If so, we:
        //   1. Parse them out of the visible output (so the user doesn't
        //      see raw JSON tool-call directives).
        //   2. Execute each against the user's stored credentials (with
        //      skill allowedConnectors enforcement).
        //   3. Run ONE follow-up AI turn with the tool results injected
        //      as a system message, so the AI can synthesize them into
        //      a human-readable response.
        //   4. The synthesized output replaces `full` and is what gets
        //      persisted + gated + delivered.
        // If no tool calls were emitted, this is a no-op.
        const toolParsed = parseToolCalls(full);
        if (toolParsed.calls.length > 0) {
          // Replace the streamed first-pass output with the cleaned version
          // (tool-call blocks removed). Send a special event so the client
          // can swap the visible content.
          full = toolParsed.cleaned;
          send({ type: "tool-call-cleaning", cleanedOutput: toolParsed.cleaned });

          // Execute each call sequentially (one per turn is the
          // documented contract, but we handle multiples gracefully).
          const toolResults: string[] = [];
          for (const call of toolParsed.calls) {
            send({
              type: "tool-call-running",
              provider: call.provider,
              kind: call.kind,
            });
            const result = await executeToolCall(effectiveUserId, call, skillAllowedConnectors);
            toolResults.push(
              `Tool call: ${call.provider}.${call.kind}(${JSON.stringify(call.args)})\n` +
              `Result: ${result.summary}`
            );
            await logAudit({
              userId: effectiveUserId,
              source: "connector",
              level: result.ok ? "info" : "warn",
              event: result.ok ? "connector.tool_call" : "connector.tool_call_failed",
              payload: {
                provider: call.provider,
                kind: call.kind,
                args: call.args,
                ok: result.ok,
                error: result.error,
              },
              chatId: activeChat.id,
            });
            // Stop after the first call — the AI asked for one result,
            // it should now synthesize before issuing another.
            break;
          }

          if (aborted) {
            controller.close();
            return;
          }

          // Run the follow-up synthesis turn. We append the original
          // user message + the AI's tool-call output (cleaned) + a
          // system message containing the tool results. The AI sees
          // this and produces a human-readable response.
          const synthesisMessages: ChatTurn[] = [
            ...messages,
            { role: "assistant" as const, content: toolParsed.cleaned },
            {
              role: "system" as const,
              content:
                "The tool calls you requested have been executed. Here are the results:\n\n" +
                toolResults.join("\n\n---\n\n") +
                "\n\nSynthesize these results into a clear response for the user. Do NOT paste the raw JSON. Explain what you found.",
            },
          ];

          // Clear the visible streamed output so the synthesis replaces it.
          send({ type: "tool-call-synthesis-start" });
          let synthesisFull = "";
          await client.stream(
            {
              model: effectiveModel,
              messages: synthesisMessages,
              temperature: 0.5,
              systemPrefix: combinedSystemPrefix ?? undefined,
            },
            {
              onToken: (t) => { if (!aborted) send({ type: "token", token: t }); },
              onDone: (f) => { synthesisFull = f; },
              onError: (e) => send({ type: "error", error: e.message }),
            }
          );
          if (synthesisFull) {
            full = synthesisFull;
          }
          send({ type: "tool-call-synthesis-done" });
        }

        // Mode gate
        const gateDecision = modeGate({
          mode: chatMode,
          output: full,
          fullBuildOnly: isFullBuildOnly,
          isPlanStep: true,
          hasUserApprovedPlan: false,
        });

        if (gateDecision.action === "require-plan-approval") {
          send({ type: "plan-required", plan: gateDecision.plan });
          // Still persist as draft
          await db.message.update({
            where: { id: assistantMsg.id },
            data: {
              content: full,
              thinking: fullThinking || null,
              sources: ragSources.length > 0 ? JSON.stringify(ragSources) : null,
              promptTokens: usage?.promptTokens,
              completionTokens: usage?.completionTokens,
              totalTokens: usage?.totalTokens,
              turnLog: JSON.stringify({ mode: chatMode, gatedAs: "plan" }),
            },
          });
          send({ type: "done", tokens: usage?.totalTokens, gated: true });
          controller.close();
          return;
        }

        if (gateDecision.action === "require-edit-approval") {
          send({ type: "edit-required", diff: gateDecision.diff });
          await db.message.update({
            where: { id: assistantMsg.id },
            data: {
              content: full,
              thinking: fullThinking || null,
              sources: ragSources.length > 0 ? JSON.stringify(ragSources) : null,
              promptTokens: usage?.promptTokens,
              completionTokens: usage?.completionTokens,
              totalTokens: usage?.totalTokens,
              turnLog: JSON.stringify({ mode: chatMode, gatedAs: "edit" }),
            },
          });
          send({ type: "done", tokens: usage?.totalTokens, gated: true });
          controller.close();
          return;
        }

        if (gateDecision.action === "reject") {
          send({ type: "rejected", reason: gateDecision.reason });
          await db.message.update({
            where: { id: assistantMsg.id },
            data: {
              content: full,
              turnLog: JSON.stringify({ mode: chatMode, rejected: gateDecision.reason }),
            },
          });
          send({ type: "done", tokens: usage?.totalTokens, rejected: true });
          controller.close();
          return;
        }

        // Deliver
        await db.message.update({
          where: { id: assistantMsg.id },
          data: {
            content: full,
            thinking: fullThinking || null,
            sources: ragSources.length > 0 ? JSON.stringify(ragSources) : null,
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: usage?.totalTokens,
          },
        });

        await logTurn({
          messageId: assistantMsg.id,
          chatId: activeChat.id,
          authorId: effectiveUserId,
          role: "assistant",
          content: full,
          model: effectiveModel,
          promptTokens: usage?.promptTokens,
          completionTokens: usage?.completionTokens,
          totalTokens: usage?.totalTokens,
        });

        // Update distillation with assistant turn
        distillState = distillTurn(distillState, { id: assistantMsg.id, role: "assistant", content: full });
        await setDistillationState(activeChat.id, distillState);

        // Send distillation update
        send({
          type: "distillation",
          state: {
            overallAlignment: distillState.overallAlignment,
            driftDetected: distillState.driftDetected,
            newEntities: distillState.turns[distillState.turns.length - 1]?.newEntities ?? [],
            newFacts: distillState.turns[distillState.turns.length - 1]?.newFacts ?? [],
            newDecisions: distillState.turns[distillState.turns.length - 1]?.newDecisions ?? [],
            entityCount: distillState.entities.length,
            factCount: distillState.facts.length,
            decisionCount: distillState.decisions.length,
            actionItemCount: distillState.actionItems.length,
            openQuestionCount: distillState.openQuestions.length,
          },
        });

        if (usage) {
          await db.usageLog.create({
            data: {
              userId: effectiveUserId,
              chatId: activeChat.id,
              model: effectiveModel,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
            },
          });
        }

        await logAudit({
          userId: effectiveUserId,
          source: "chat",
          event: "chat.completed",
          payload: {
            chatId: activeChat.id,
            messageId: assistantMsg.id,
            model: effectiveModel,
            mode: chatMode,
            fullBuildOnly: isFullBuildOnly,
            skillId: skillId ?? null,
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: usage?.totalTokens,
          },
          chatId: activeChat.id,
        });

        send({ type: "done", tokens: usage?.totalTokens });
      } catch (e) {
        await logAudit({
          userId: effectiveUserId,
          source: "chat",
          level: "error",
          event: "chat.error",
          payload: { chatId: activeChat.id, error: String(e) },
          chatId: activeChat.id,
        });
        send({ type: "error", error: String(e) });
      } finally {
        signal.removeEventListener("abort", onAbort);
        controller.close();
      }
    },
    cancel() {
      // Client disconnected — stream will be GC'd
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering (nginx/Railway edge) so tokens reach
      // the client as they stream — ported from ragdb.
      "X-Accel-Buffering": "no",
    },
  });
}
