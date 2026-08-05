import type { ImageMime } from '@rit/shared';

/**
 * Identifies an upload from its own bytes and reads its pixel dimensions.
 *
 * This is the upload security boundary, not a convenience. The client's
 * `Content-Type` header and filename are both attacker-controlled, so neither
 * may decide what we store or what extension we give it: a `.jpg` that is
 * really an HTML document, served back from our own origin, is stored XSS.
 * Only a format we can actually parse gets an extension, and that extension is
 * derived here — see AGENTS.md §10 and the media README.
 *
 * Dimensions come out of the same parse because the header already has to be
 * walked. They let the reader app reserve the right box before the image loads,
 * which on a kitchen iPad is the difference between a stable recipe page and
 * one that jumps under a cook's finger.
 *
 * Deliberately dependency-free: `sharp` is a native build, and reading four
 * integers out of a header does not justify one.
 */

export interface ImageMeta {
  mime: ImageMime;
  /** Canonical extension for this format. Never taken from the filename. */
  ext: 'jpg' | 'png' | 'webp';
  width: number;
  height: number;
}

/** Every multi-byte read is bounds-checked — the buffer is untrusted input. */
function has(buf: Buffer, offset: number, length: number): boolean {
  return offset >= 0 && offset + length <= buf.length;
}

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (!has(buf, offset, bytes.length)) return false;
  return bytes.every((byte, i) => buf[offset + i] === byte);
}

/**
 * JPEG: walk the marker segments to the frame header (SOF) that carries the
 * dimensions. It is not at a fixed offset — EXIF, ICC profiles and comments all
 * sit in front of it, and a phone photo has plenty of each.
 */
function jpegMeta(buf: Buffer): ImageMeta | null {
  if (!startsWith(buf, [0xff, 0xd8])) return null;

  let offset = 2;
  while (has(buf, offset, 4)) {
    // Segments are byte-aligned on 0xFF; padding fill bytes are legal between them.
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];

    // Standalone markers: no length field, so no payload to skip.
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }

    const length = buf.readUInt16BE(offset + 2);
    // A segment length always includes its own two bytes; anything less is corrupt.
    if (length < 2) return null;

    // SOF0–SOF15 carry the frame size, except DHT (C4), JPG (C8) and DAC (CC).
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isFrameHeader) {
      // Payload: [precision:1][height:2][width:2][components:1]
      if (!has(buf, offset + 5, 4)) return null;
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      if (width === 0 || height === 0) return null;
      return { mime: 'image/jpeg', ext: 'jpg', width, height };
    }

    offset += 2 + length;
  }

  return null;
}

/** PNG: fixed layout — the IHDR chunk is always the first one after the signature. */
function pngMeta(buf: Buffer): ImageMeta | null {
  if (!startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return null;
  // Signature (8) + chunk length (4) + 'IHDR' (4) → width at 16, height at 20.
  if (!has(buf, 16, 8)) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;

  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width === 0 || height === 0) return null;
  return { mime: 'image/png', ext: 'png', width, height };
}

/**
 * WebP: a RIFF container whose first chunk names the variant. All three encode
 * their size differently, and Safari now exports WebP, so all three turn up.
 */
function webpMeta(buf: Buffer): ImageMeta | null {
  if (!startsWith(buf, [0x52, 0x49, 0x46, 0x46])) return null; // 'RIFF'
  if (!has(buf, 8, 4) || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  if (!has(buf, 12, 4)) return null;

  const variant = buf.toString('ascii', 12, 16);
  const found = (width: number, height: number): ImageMeta | null =>
    width > 0 && height > 0 ? { mime: 'image/webp', ext: 'webp', width, height } : null;

  // Lossy: a VP8 keyframe. Dimensions follow the 3-byte sync code 9D 01 2A.
  if (variant === 'VP8 ') {
    if (!has(buf, 23, 7)) return null;
    if (!startsWith(buf, [0x9d, 0x01, 0x2a], 23)) return null;
    // 14-bit values, little-endian; the top 2 bits are a scaling hint.
    return found(buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff);
  }

  // Lossless: 0x2F signature, then width-1 and height-1 packed into 28 bits.
  if (variant === 'VP8L') {
    if (!has(buf, 21, 4) || buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    return found((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }

  // Extended (alpha/animation): canvas size as two 24-bit little-endian values.
  if (variant === 'VP8X') {
    if (!has(buf, 24, 6)) return null;
    const width = buf.readUIntLE(24, 3) + 1;
    const height = buf.readUIntLE(27, 3) + 1;
    return found(width, height);
  }

  return null;
}

/**
 * Returns the format and dimensions of `buf`, or null when it is not one of the
 * image formats we accept. A null result means "reject this upload" — never
 * fall back to the client's declared type.
 */
export function sniffImage(buf: Buffer): ImageMeta | null {
  return pngMeta(buf) ?? jpegMeta(buf) ?? webpMeta(buf);
}
