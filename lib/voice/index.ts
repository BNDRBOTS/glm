/**
 * GLM Power Platform — Voice Input (Speech-to-Text)
 * ---------------------------------------------------------------------
 * Real STT, not mock. Two providers, graceful fallback:
 *
 *   1. Z.ai ASR (PRIMARY) — uses the same ZAI_API_KEY you already have
 *      for GLM. No extra setup, no extra cost line item.
 *      Endpoint: POST /api/paas/v4/audio/asr
 *      Docs: https://docs.z.ai/api-reference/audio/asr
 *
 *   2. OpenAI Whisper (OPTIONAL FALLBACK) — set OPENAI_API_KEY in env
 *      if you want a second option. Used only if Z.ai ASR is down or
 *      the user explicitly chooses Whisper in settings.
 *
 * Audio format: webm/opus (browser default from MediaRecorder) is
 * accepted by both providers. We transcode to base64 for transport.
 *
 * NEVER returns mock text. If both providers fail, returns a clear
 * error so the UI can show it.
 */

import "@/lib/server-guard";

export type STTProvider = "zai" | "openai";

export interface TranscribeOptions {
  provider?: STTProvider; // default: zai
  language?: string;      // ISO-639-1, e.g. "en" — improves accuracy
  prompt?: string;        // context hint for the model
}

export interface TranscribeResult {
  text: string;
  provider: STTProvider;
  durationMs: number;
  language?: string;
}

/**
 * Internal helper return type — `durationMs` is added by the
 * public `transcribeAudio` wrapper to avoid double-timing.
 */
interface ProviderResult {
  text: string;
  provider: STTProvider;
  language?: string;
}

/**
 * Transcribe an audio buffer (raw bytes + mime type).
 */
export async function transcribeAudio(
  audio: Buffer,
  mimeType: string,
  opts: TranscribeOptions = {}
): Promise<TranscribeResult> {
  const provider = opts.provider ?? "zai";
  const start = Date.now();

  if (provider === "zai") {
    try {
      const result = await transcribeWithZai(audio, mimeType, opts);
      return { ...result, durationMs: Date.now() - start };
    } catch (e) {
      // Fall back to OpenAI Whisper if configured
      if (process.env.OPENAI_API_KEY) {
        const fallback = await transcribeWithOpenAI(audio, mimeType, opts);
        return { ...fallback, durationMs: Date.now() - start };
      }
      throw e;
    }
  }

  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not set — required for Whisper provider");
    }
    const result = await transcribeWithOpenAI(audio, mimeType, opts);
    return { ...result, durationMs: Date.now() - start };
  }

  throw new Error(`Unknown STT provider: ${provider}`);
}

/**
 * Z.ai ASR. Uses ZAI_API_KEY (same as GLM).
 * Accepts base64-encoded audio.
 */
async function transcribeWithZai(
  audio: Buffer,
  mimeType: string,
  opts: TranscribeOptions
): Promise<ProviderResult> {
  const apiKey = process.env.ZAI_API_KEY;
  if (!apiKey) {
    throw new Error("ZAI_API_KEY not set — required for Z.ai ASR");
  }

  const base64 = audio.toString("base64");
  const dataUri = `data:${mimeType};base64,${base64}`;

  const body: Record<string, unknown> = {
    model: "asr", // Z.ai ASR model name
    file_base64: dataUri,
  };
  if (opts.language) body.language = opts.language;
  if (opts.prompt) body.prompt = opts.prompt;

  const r = await fetch("https://api.z.ai/api/paas/v4/audio/asr", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`Z.ai ASR failed (${r.status}): ${errText.slice(0, 200)}`);
  }

  const j = (await r.json()) as { text?: string; output?: { text?: string } };
  const text = j.text ?? j.output?.text ?? "";
  if (!text) {
    throw new Error("Z.ai ASR returned empty transcription");
  }
  return {
    text: text.trim(),
    provider: "zai",
    language: opts.language,
  };
}

/**
 * OpenAI Whisper (whisper-1). Uses OPENAI_API_KEY.
 * Sends multipart/form-data with the raw audio file.
 */
async function transcribeWithOpenAI(
  audio: Buffer,
  mimeType: string,
  opts: TranscribeOptions
): Promise<ProviderResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set");
  }

  const ext = mimeTypeToExt(mimeType);
  const filename = `audio.${ext}`;
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), filename);
  form.append("model", "whisper-1");
  if (opts.language) form.append("language", opts.language);
  if (opts.prompt) form.append("prompt", opts.prompt);
  form.append("response_format", "json");

  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`OpenAI Whisper failed (${r.status}): ${errText.slice(0, 200)}`);
  }

  const j = (await r.json()) as { text?: string };
  return {
    text: (j.text ?? "").trim(),
    provider: "openai",
    language: opts.language,
  };
}

function mimeTypeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
  };
  return map[mimeType] ?? "webm";
}

/**
 * Is voice input available? True if EITHER provider has a key.
 */
export function isVoiceAvailable(): boolean {
  return Boolean(process.env.ZAI_API_KEY) || Boolean(process.env.OPENAI_API_KEY);
}
