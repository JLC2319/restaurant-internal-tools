import { describe, it, expect } from 'vitest';
import { sniffImage } from '../../../lib/imageMeta';

/**
 * `sniffImage` is the upload security boundary: it decides both what an upload
 * *is* and what extension it gets stored under. The rejection cases below
 * matter as much as the happy path — an SVG or an HTML document accepted as an
 * image and served back from our own CDN origin is stored XSS.
 */

// ── Minimal but structurally valid fixtures ───────────────────────────────────

function png(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8); // IHDR chunk length
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

/**
 * SOI, then an APP0/JFIF segment, then the SOF0 frame header. The leading
 * segment is the point: a real phone photo buries the frame header behind EXIF
 * and colour profiles, so the parser has to walk rather than read a fixed offset.
 */
function jpeg(width: number, height: number, sofMarker = 0xc0): Buffer {
  const app0 = Buffer.alloc(20);
  app0.writeUInt16BE(0xffe0, 0);
  app0.writeUInt16BE(18, 2); // segment length, including these two bytes
  app0.write('JFIF\0', 4, 'ascii');

  const sof = Buffer.alloc(11);
  sof.writeUInt8(0xff, 0);
  sof.writeUInt8(sofMarker, 1);
  sof.writeUInt16BE(9, 2); // length
  sof.writeUInt8(8, 4); // sample precision
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof.writeUInt8(3, 9); // component count

  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

function webpHeader(variant: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(20);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(payload.length + 12, 4);
  head.write('WEBP', 8, 'ascii');
  head.write(variant, 12, 'ascii');
  head.writeUInt32LE(payload.length, 16);
  return Buffer.concat([head, payload]);
}

function webpLossy(width: number, height: number): Buffer {
  const payload = Buffer.alloc(14);
  // 3-byte frame tag, then the keyframe sync code, then the dimensions.
  Buffer.from([0x9d, 0x01, 0x2a]).copy(payload, 3);
  payload.writeUInt16LE(width, 6);
  payload.writeUInt16LE(height, 8);
  return webpHeader('VP8 ', payload);
}

function webpLossless(width: number, height: number): Buffer {
  const payload = Buffer.alloc(10);
  payload.writeUInt8(0x2f, 0);
  payload.writeUInt32LE((width - 1) | ((height - 1) << 14), 1);
  return webpHeader('VP8L', payload);
}

function webpExtended(width: number, height: number): Buffer {
  const payload = Buffer.alloc(10);
  payload.writeUInt8(0x10, 0); // flags
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  return webpHeader('VP8X', payload);
}

// ── Accepted formats ──────────────────────────────────────────────────────────

describe('sniffImage', () => {
  it('reads PNG dimensions from the IHDR chunk', () => {
    expect(sniffImage(png(1920, 1080))).toEqual({
      mime: 'image/png',
      ext: 'png',
      width: 1920,
      height: 1080,
    });
  });

  it('walks JPEG segments to find the frame header', () => {
    expect(sniffImage(jpeg(4032, 3024))).toEqual({
      mime: 'image/jpeg',
      ext: 'jpg',
      width: 4032,
      height: 3024,
    });
  });

  it('reads progressive JPEGs, which use a different SOF marker', () => {
    // SOF2 — what most phone cameras and image pipelines emit today.
    expect(sniffImage(jpeg(800, 600, 0xc2))?.width).toBe(800);
  });

  it.each([
    ['lossy VP8', webpLossy(1200, 900)],
    ['lossless VP8L', webpLossless(1200, 900)],
    ['extended VP8X', webpExtended(1200, 900)],
  ])('reads %s WebP dimensions', (_label, buffer) => {
    expect(sniffImage(buffer)).toEqual({
      mime: 'image/webp',
      ext: 'webp',
      width: 1200,
      height: 900,
    });
  });

  // ── Rejections ──────────────────────────────────────────────────────────────

  it('rejects an SVG, which is a script-execution vector, not a photo', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(sniffImage(svg)).toBeNull();
  });

  it('rejects an HTML document wearing an image filename', () => {
    expect(sniffImage(Buffer.from('<!doctype html><html><body>hi</body></html>'))).toBeNull();
  });

  it('rejects a GIF — a real image, but not a format we accept', () => {
    const gif = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(20)]);
    expect(sniffImage(gif)).toBeNull();
  });

  it('rejects an empty upload', () => {
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });

  it('rejects a truncated PNG rather than reading past the buffer', () => {
    expect(sniffImage(png(100, 100).subarray(0, 18))).toBeNull();
  });

  it('rejects a JPEG whose frame header never arrives', () => {
    // SOI followed by a segment that runs to the end of the buffer.
    const buf = Buffer.alloc(40);
    buf.writeUInt16BE(0xffd8, 0);
    buf.writeUInt16BE(0xffe0, 2);
    buf.writeUInt16BE(36, 4);
    expect(sniffImage(buf)).toBeNull();
  });

  it('rejects a zero-dimension image', () => {
    expect(sniffImage(png(0, 100))).toBeNull();
  });

  it('rejects a RIFF container that is not WebP', () => {
    const wav = Buffer.alloc(40);
    wav.write('RIFF', 0, 'ascii');
    wav.write('WAVE', 8, 'ascii');
    expect(sniffImage(wav)).toBeNull();
  });
});
