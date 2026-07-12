export async function parseTxt(buffer: Buffer): Promise<string> {
  return buffer.toString("utf-8");
}
