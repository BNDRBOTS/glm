/**
 * RAG document parsers — MIME-dispatched text extraction.
 * ---------------------------------------------------------------------
 * Ported from the RAG Chat platform (ragdb). One parser per format:
 *
 *   PDF      application/pdf                       unpdf (serverless pdfjs)
 *   Word     ...wordprocessingml.document (.docx)  mammoth
 *   Excel    ...spreadsheetml.sheet (.xlsx)        xlsx (per-sheet CSV)
 *   Text     text/plain (.txt)                     direct utf-8
 *   Markdown text/markdown (.md)                   direct utf-8
 *
 * Browsers sometimes report an empty/unknown MIME type (notably for
 * .md files), so `resolveMimeType` falls back to the file extension.
 */

export { parsePdf } from "./pdf";
export { parseDocx } from "./docx";
export { parseXlsx } from "./xlsx";
export { parseTxt } from "./txt";

import { parsePdf } from "./pdf";
import { parseDocx } from "./docx";
import { parseXlsx } from "./xlsx";
import { parseTxt } from "./txt";

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const MIME_DISPATCH: Record<string, (buffer: Buffer) => Promise<string>> = {
  "application/pdf": parsePdf,
  [DOCX_MIME]: parseDocx,
  [XLSX_MIME]: parseXlsx,
  "text/plain": parseTxt,
  "text/markdown": parseTxt,
};

/** MIME types the ingest pipeline accepts — same set as ragdb. */
export const ALLOWED_MIME = new Set(Object.keys(MIME_DISPATCH));

const EXTENSION_MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: DOCX_MIME,
  xlsx: XLSX_MIME,
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
};

/**
 * Resolve the effective MIME type for a file: trust the declared type
 * when it's in the allowed set, otherwise fall back to the extension.
 * Returns null when neither identifies a supported format.
 */
export function resolveMimeType(filename: string, declaredType: string | null | undefined): string | null {
  if (declaredType && ALLOWED_MIME.has(declaredType)) return declaredType;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME[ext] ?? null;
}

export async function parseDocument(buffer: Buffer, mimeType: string): Promise<string> {
  const parser = MIME_DISPATCH[mimeType];
  if (!parser) {
    throw new Error(`Unsupported MIME type: ${mimeType}`);
  }
  return parser(buffer);
}
