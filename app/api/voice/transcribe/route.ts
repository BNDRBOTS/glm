/**
 * POST /api/voice/transcribe
 * ---------------------------------------------------------------------
 * Body: multipart/form-data with audio file
 *   - file: audio blob (webm/opus from MediaRecorder)
 *   - provider: "zai" | "openai" (optional, default "zai")
 *   - language: ISO-639-1 (optional)
 *   - prompt: context hint (optional)
 *
 * Returns: { text, provider, durationMs }
 *
 * Real STT — never returns mock text.
 */

import { NextRequest, NextResponse } from "next/server";
import { transcribeAudio, isVoiceAvailable, type STTProvider } from "@/lib/voice";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;

  if (!isVoiceAvailable()) {
    return NextResponse.json(
      {
        error:
          "Voice input not configured. Set ZAI_API_KEY (for Z.ai ASR, recommended) or OPENAI_API_KEY (for Whisper fallback).",
      },
      { status: 503 }
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  const provider = (form.get("provider") as STTProvider | null) ?? "zai";
  const language = (form.get("language") as string | null) ?? undefined;
  const prompt = (form.get("prompt") as string | null) ?? undefined;

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
  }

  // Cap audio size to prevent abuse (10 MB).
  const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: `Audio file too large (max ${MAX_AUDIO_BYTES / 1024 / 1024} MB)` },
      { status: 413 }
    );
  }

  const arrayBuf = await file.arrayBuffer();
  const audio = Buffer.from(arrayBuf);
  const mimeType = file.type || "audio/webm";

  try {
    const result = await transcribeAudio(audio, mimeType, { provider, language, prompt });
    await logAudit({
      userId: userId!,
      source: "voice",
      event: "transcription.success",
      payload: {
        provider: result.provider,
        durationMs: result.durationMs,
        audioBytes: audio.length,
        mimeType,
        textLength: result.text.length,
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    await logAudit({
      userId: userId!,
      source: "voice",
      level: "error",
      event: "transcription.failed",
      payload: {
        provider,
        audioBytes: audio.length,
        error: (e as Error).message,
      },
    });
    return NextResponse.json(
      { error: `Transcription failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
