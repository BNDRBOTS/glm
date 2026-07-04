"use client";

import * as React from "react";

/**
 * Voice recorder hook — uses MediaRecorder API.
 * Records audio in webm/opus (best quality per byte, accepted by Z.ai ASR
 * and OpenAI Whisper).
 *
 * Graceful fallback: if mic permission denied or MediaRecorder not
 * available (older browsers), returns an error state.
 */

export interface UseVoiceRecorder {
  isRecording: boolean;
  isTranscribing: boolean;
  error: string | null;
  seconds: number;
  start: () => Promise<void>;
  stop: () => Promise<Blob | null>;
  cancel: () => void;
}

export function useVoiceRecorder(): UseVoiceRecorder {
  const [isRecording, setIsRecording] = React.useState(false);
  const [isTranscribing, setIsTranscribing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [seconds, setSeconds] = React.useState(0);

  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const streamRef = React.useRef<MediaStream | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = React.useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setSeconds(0);
  }, []);

  const start = React.useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError("Voice input not supported in this browser. Try Chrome, Edge, or Safari.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);

      timerRef.current = setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
    } catch (e) {
      const err = e as Error;
      if (err.name === "NotAllowedError") {
        setError("Microphone permission denied. Allow mic access in browser settings.");
      } else if (err.name === "NotFoundError") {
        setError("No microphone detected. Connect a mic and try again.");
      } else {
        setError(`Mic error: ${err.message}`);
      }
    }
  }, []);

  const stop = React.useCallback(async (): Promise<Blob | null> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || !isRecording) return null;

    return new Promise((resolve) => {
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setIsRecording(false);
        setIsTranscribing(true);
        cleanup();
        resolve(blob);
      };
      recorder.stop();
    });
  }, [isRecording, cleanup]);

  const cancel = React.useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      try { recorder.stop(); } catch {}
    }
    setIsRecording(false);
    setIsTranscribing(false);
    cleanup();
  }, [cleanup]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  return {
    isRecording,
    isTranscribing,
    error,
    seconds,
    start,
    stop,
    cancel,
  };
}

function pickMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return undefined;
}
