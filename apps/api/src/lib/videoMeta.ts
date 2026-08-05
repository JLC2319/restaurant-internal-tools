import type { VideoMime } from '@rit/shared';

/**
 * Identifies a video upload from its own bytes — the same security boundary as
 * `sniffImage`, applied to the sniff window of a stream instead of a whole
 * buffer. The client's `Content-Type` and filename never decide what we store
 * (AGENTS.md §10); a file that does not parse as one of our containers is a
 * 415 before a single byte reaches object storage.
 *
 * Unlike images we do not dig out dimensions: they live deep in the moov atom
 * (often at the *end* of an MP4), and the reader renders video in a fixed
 * 16:9 frame anyway. `width`/`height` stay null on video assets.
 */

export interface VideoMeta {
  mime: VideoMime;
  /** Canonical extension for this container. Never taken from the filename. */
  ext: 'mp4' | 'webm';
}

/**
 * MP4 (ISO BMFF): the file must open with an `ftyp` box. The major brand
 * distinguishes real MP4s from QuickTime `.mov` files, which share the
 * structure but not the browser support — HEVC-in-.mov plays on Apple devices
 * and almost nowhere else, so without a transcode pipeline we reject the
 * container outright rather than store trainings that only some staff can play.
 */
function mp4Meta(buf: Buffer): VideoMeta | null {
  if (buf.length < 12) return null;
  if (buf.toString('ascii', 4, 8) !== 'ftyp') return null;

  // The box size field is trustworthy enough to sanity-check: an ftyp box is
  // its 8-byte header, a brand, a version, and a short list of compatible
  // brands. Anything claiming to be huge is not a real ftyp box.
  const boxSize = buf.readUInt32BE(0);
  if (boxSize < 12 || boxSize > 1024) return null;

  const majorBrand = buf.toString('ascii', 8, 12);
  if (majorBrand.startsWith('qt')) return null; // QuickTime — see above.

  return { mime: 'video/mp4', ext: 'mp4' };
}

/**
 * WebM: an EBML document whose DocType is exactly `webm`. The DocType element
 * (id 0x4282) sits within the EBML header a few bytes in — scanning a bounded
 * window for it is how we tell WebM from its sibling Matroska (`.mkv`), which
 * browsers do not reliably play.
 */
function webmMeta(buf: Buffer): VideoMeta | null {
  if (buf.length < 8) return null;
  if (buf[0] !== 0x1a || buf[1] !== 0x45 || buf[2] !== 0xdf || buf[3] !== 0xa3) return null;

  const window = Math.min(buf.length, 96);
  for (let i = 4; i < window - 7; i++) {
    if (buf[i] !== 0x42 || buf[i + 1] !== 0x82) continue;
    // Element length is an EBML vint; DocType strings are short, so a
    // single-byte length (top bit set) is the only shape worth accepting.
    const lengthByte = buf[i + 2];
    if ((lengthByte & 0x80) === 0) return null;
    const length = lengthByte & 0x7f;
    if (length !== 4) return null;
    return buf.toString('ascii', i + 3, i + 7) === 'webm'
      ? { mime: 'video/webm', ext: 'webm' }
      : null;
  }
  return null;
}

/**
 * Returns the container of `buf` (the first few KB of an upload), or null when
 * it is not a video we accept. Null means "reject with 415" — never fall back
 * to the client's declared type.
 */
export function sniffVideo(buf: Buffer): VideoMeta | null {
  return mp4Meta(buf) ?? webmMeta(buf);
}
