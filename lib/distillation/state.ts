/**
 * Shared distillation state — Redis-backed with in-memory fallback.
 * ---------------------------------------------------------------------
 * Single source of truth — both /api/chat (writer) and
 * /api/distillation (reader) import from here.
 *
 * Backend selection (automatic):
 *   - REDIS_URL set:   Redis. Works across replicas. State survives
 *                       process restarts up to TTL.
 *   - REDIS_URL unset: in-memory Map. Single-replica only. State is
 *                       lost on restart.
 *
 * State is serialized as JSON and stored under key:
 *   distillation:{chatId}
 *
 * TTL: 24 hours. If a chat goes idle for >24h, the distillation state
 * resets on next message — initState() re-bootstraps from the new
 * first message. This is the right behavior: a 24h-old session has
 * effectively drifted anyway.
 *
 * Note: distillation is a real-time layer. The slow layer
 * (MemoryLog + extractDeep in lib/memory) is the source of truth
 * across sessions. Losing distillation state mid-session is a UX
 * regression (the alignment badge resets) but never a data loss.
 */

import type { DistillationState } from "./index";
import { getRedis } from "@/lib/redis";

const KEY_PREFIX = "distillation:";
const TTL_SECONDS = 24 * 60 * 60; // 24 hours

export async function getDistillationState(chatId: string): Promise<DistillationState | null> {
  try {
    const redis = await getRedis();
    const raw = await redis.get(`${KEY_PREFIX}${chatId}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as DistillationState;
    } catch {
      // Corrupt state — clear it so the next write is clean.
      await redis.del(`${KEY_PREFIX}${chatId}`);
      return null;
    }
  } catch (e) {
    // Failsafe: return null (treated as "no prior state" by callers,
    // which calls initState() to bootstrap). The chat still works.
    console.warn(`[distillation] get failed for ${chatId}: ${(e as Error).message}`);
    return null;
  }
}

export async function setDistillationState(chatId: string, state: DistillationState): Promise<void> {
  try {
    const redis = await getRedis();
    await redis.set(`${KEY_PREFIX}${chatId}`, JSON.stringify(state), TTL_SECONDS);
  } catch (e) {
    // Failsafe: swallow. The chat continues to work; the badge just
    // won't persist across requests. Logged loud so ops notices.
    console.warn(`[distillation] set failed for ${chatId}: ${(e as Error).message}`);
  }
}

export async function clearDistillationState(chatId: string): Promise<void> {
  try {
    const redis = await getRedis();
    await redis.del(`${KEY_PREFIX}${chatId}`);
  } catch (e) {
    console.warn(`[distillation] clear failed for ${chatId}: ${(e as Error).message}`);
  }
}
