/**
 * PDF parser — unpdf ships a serverless-safe pdfjs build: no worker,
 * no canvas, no native deps. Correct for Node route handlers on
 * Railway / Vercel. Lazy-loaded per the platform rule: heavy SDKs
 * import inside function bodies for fast cold starts.
 */
export async function parsePdf(buffer: Buffer): Promise<string> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}
