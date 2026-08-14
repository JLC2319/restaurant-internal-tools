/**
 * Identifies a PDF upload from its own bytes — the same security rule as
 * `sniffImage`/`sniffVideo`: the client's Content-Type and filename are
 * attacker-controlled and never decide anything. Drafting PDFs are never
 * stored, but what gets base64-encoded into a model request is still decided
 * by the bytes, not the label.
 *
 * The check is the `%PDF-` header magic. Deliberately no structural parse —
 * the model is the consumer and rejects broken files itself; this only keeps
 * arbitrary non-PDF uploads from riding the document lane.
 */
export function sniffPdf(buffer: Buffer): boolean {
  if (buffer.length < 5) return false;
  return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}
