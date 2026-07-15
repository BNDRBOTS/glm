/**
 * Redis client — singleton with in-memory fallback.
 * ---------------------------------------------------------------------
 * If REDIS_URL is set: real Redis (ioredis). Used for:
 *   - distillation state (replaces in-memory Map, works across replicas)
 *   - rate limiting counters
 *   - future: session cache, feature flags
 *
 * If REDIS_URL is NOT set: in-memory Map fallback. Single-replica dev
 * and preview deployments work without Redis. The interface is
 * identical so callers don't branch.
 *
 * Health: getRedisStatus() returns { configured, connected }. The
 * /api/health endpoint uses it for dependency checks.
 *
 * Failover: if Redis is configured but goes down mid-request, ioredis
 * throws — callers MUST catch and fall back to a safe default (e.g.
 * allow the request through, log the failure). We do NOT silently
 * degrade to in-memory after a Redis drop because that would split
 * state across replicas. The right behavior is: log loud, fail the
 * specific feature, keep the app serving other requests.
 */

import "@/lib/server-guard";

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string, ttlSeconds: number): Promise<number>;
  /** Returns the keys matching a prefix. Use sparingly — O(n). */
  keys(prefix: string): Promise<string[]>;
  ping(): Promise<boolean>;
}

let _client: RedisLike | null = null;
let _initTried = false;

function getRedisUrl(): string | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  // Accept redis://, rediss:// (TLS), and bare host:port.
  if (url.startsWith("redis://") || url.startsWith("rediss://")) return url;
  // Treat bare "host:port" as redis://host:port
  if (/^[a-z0-9.\-]+:\d+$/.test(url)) return `redis://${url}`;
  return null;
}

async function createClient(): Promise<RedisLike> {
  const url = getRedisUrl();
  if (!url) return new InMemoryRedis();
  try {
    const IORedis = (await import("ioredis")).default;
    const io = new IORedis(url, {
      // Lazy connect — don't crash the process if Redis is down at boot.
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy(times: number) {
        if (times > 5) return null; // give up after 5 retries
        return Math.min(times * 200, 2000);
      },
    });
    await io.connect();
    return new RealRedis(io);
  } catch (e) {
    console.warn(
      `[redis] failed to connect to ${url.replace(/:[^:@]+@/, ":***@")} — ` +
      `falling back to in-memory. Distillation state + rate limits will ` +
      `not be shared across replicas. Error: ${(e as Error).message}`
    );
    return new InMemoryRedis();
  }
}

export async function getRedis(): Promise<RedisLike> {
  if (!_initTried) {
    _initTried = true;
    _client = await createClient();
  }
  return _client!;
}

/**
 * Synchronous status check — used by /api/health without awaiting a
 * full client init. Returns { configured: bool, connected: bool }.
 */
export function getRedisStatus(): { configured: boolean; connected: boolean } {
  return {
    configured: Boolean(getRedisUrl()),
    connected: _client instanceof RealRedis,
  };
}

/**
 * Reset the client — used by tests to isolate state.
 */
export async function resetRedisForTests(): Promise<void> {
  if (_client && _client instanceof InMemoryRedis) {
    (_client as InMemoryRedis).clear();
  }
  _client = null;
  _initTried = false;
}

// ---------------------------------------------------------------------
// Real Redis adapter
// ---------------------------------------------------------------------

class RealRedis implements RedisLike {
  constructor(private io: import("ioredis").default) {}

  async get(key: string): Promise<string | null> {
    return this.io.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds && ttlSeconds > 0) {
      await this.io.set(key, value, "EX", ttlSeconds);
    } else {
      await this.io.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.io.del(key);
  }

  /**
   * Atomic increment with TTL. Uses a Lua script to set the TTL only
   * on the first increment (so the window doesn't keep resetting).
   */
  async incr(key: string, ttlSeconds: number): Promise<number> {
    const lua = `
      local current = redis.call('INCR', KEYS[1])
      if current == 1 then
        redis.call('EXPIRE', KEYS[1], ARGV[1])
      end
      return current
    `;
    return (await this.io.eval(lua, 1, key, ttlSeconds)) as number;
  }

  async keys(prefix: string): Promise<string[]> {
    return this.io.keys(`${prefix}*`);
  }

  async ping(): Promise<boolean> {
    const r = await this.io.ping();
    return r === "PONG";
  }
}

// ---------------------------------------------------------------------
// In-memory fallback — single-replica only
// ---------------------------------------------------------------------

class InMemoryRedis implements RedisLike {
  private store = new Map<string, { value: string; expiresAt?: number }>();
  private lastSweep = 0;

  // Expired entries are only removed lazily on get(); under sustained
  // traffic with high-cardinality keys (rate-limit buckets per IP),
  // the map would otherwise grow without bound. Sweep opportunistically
  // when the map is large, at most once a minute.
  private static readonly SWEEP_THRESHOLD = 5_000;
  private static readonly SWEEP_MIN_INTERVAL_MS = 60_000;

  private maybeSweep(): void {
    const now = Date.now();
    if (this.store.size < InMemoryRedis.SWEEP_THRESHOLD) return;
    if (now - this.lastSweep < InMemoryRedis.SWEEP_MIN_INTERVAL_MS) return;
    this.lastSweep = now;
    for (const [key, entry] of this.store) {
      if (entry.expiresAt && entry.expiresAt < now) this.store.delete(key);
    }
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.maybeSweep();
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const current = parseInt((await this.get(key)) ?? "0", 10);
    const next = current + 1;
    if (current === 0) {
      await this.set(key, String(next), ttlSeconds);
    } else {
      // Preserve existing TTL
      const entry = this.store.get(key);
      if (entry) entry.value = String(next);
    }
    return next;
  }

  async keys(prefix: string): Promise<string[]> {
    const out: string[] = [];
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) out.push(key);
    }
    return out;
  }

  async ping(): Promise<boolean> {
    return true;
  }

  clear(): void {
    this.store.clear();
  }
}
