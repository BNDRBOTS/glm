/**
 * AES-GCM encrypt/decrypt for credentials at rest.
 * Key comes from app env (INTEGRATION_ENCRYPTION_KEY). If unset, a
 * deterministic dev key is used so the app still runs locally —
 * but you MUST set a real 32-byte key in production.
 */

import "@/lib/server-guard";
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "crypto";

const DEV_KEY = "glm-power-platform-dev-key-do-not-use-in-prod-32b!";

function getKey(): Buffer {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "INTEGRATION_ENCRYPTION_KEY must be set in production. " +
        "Generate one with: openssl rand -hex 32"
      );
    }
    // Dev fallback — log loudly so it's never silently deployed.
    console.warn(
      "[crypto] INTEGRATION_ENCRYPTION_KEY not set — using insecure dev key. " +
      "Set INTEGRATION_ENCRYPTION_KEY in your environment before deploying."
    );
    return createHash("sha256").update(DEV_KEY).digest();
  }
  if (raw.length < 16) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY must be at least 16 characters. " +
      "Use a 32+ char random string (openssl rand -hex 32)."
    );
  }
  return createHash("sha256").update(raw).digest();
}

export async function encrypt(plain: string): Promise<string> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export async function decrypt(payload: string): Promise<string> {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}
