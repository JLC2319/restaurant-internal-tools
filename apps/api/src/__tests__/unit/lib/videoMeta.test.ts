import { describe, it, expect } from 'vitest';
import { sniffVideo } from '../../../lib/videoMeta';

/**
 * `sniffVideo` is the upload security boundary for training videos, exactly as
 * `sniffImage` is for photos: the first bytes decide the container, and a null
 * verdict means 415 before anything reaches storage.
 */

/** A minimal ISO BMFF opening: [size]['ftyp'][major brand][minor][compat...]. */
function mp4Bytes(majorBrand = 'isom'): Buffer {
  const buf = Buffer.alloc(32);
  buf.writeUInt32BE(24, 0);
  buf.write('ftyp', 4, 'ascii');
  buf.write(majorBrand, 8, 'ascii');
  buf.writeUInt32BE(0, 12); // minor version
  buf.write('isomavc1', 16, 'ascii'); // compatible brands
  return buf;
}

/** A realistic EBML header opening with the given DocType. */
function ebmlBytes(docType: string): Buffer {
  const head = Buffer.from([
    0x1a,
    0x45,
    0xdf,
    0xa3, // EBML magic
    0x9f, // header size (unknown-ish vint, irrelevant to the sniff)
    0x42,
    0x86,
    0x81,
    0x01, // EBMLVersion = 1
    0x42,
    0xf7,
    0x81,
    0x01, // EBMLReadVersion = 1
    0x42,
    0x82,
    0x80 | docType.length, // DocType, single-byte length vint
  ]);
  return Buffer.concat([head, Buffer.from(docType, 'ascii'), Buffer.alloc(16)]);
}

describe('sniffVideo', () => {
  it('identifies MP4 across common major brands', () => {
    for (const brand of ['isom', 'iso2', 'mp42', 'avc1', 'M4V ', 'dash']) {
      expect(sniffVideo(mp4Bytes(brand))).toEqual({ mime: 'video/mp4', ext: 'mp4' });
    }
  });

  it('rejects QuickTime — plays on Apple hardware and almost nowhere else', () => {
    expect(sniffVideo(mp4Bytes('qt  '))).toBeNull();
  });

  it('identifies WebM by its DocType', () => {
    expect(sniffVideo(ebmlBytes('webm'))).toEqual({ mime: 'video/webm', ext: 'webm' });
  });

  it('rejects Matroska — same EBML shell, no reliable browser support', () => {
    expect(sniffVideo(ebmlBytes('matroska'))).toBeNull();
  });

  it('rejects an ftyp box claiming an absurd size', () => {
    const buf = mp4Bytes();
    buf.writeUInt32BE(0x7fffffff, 0);
    expect(sniffVideo(buf)).toBeNull();
  });

  it('rejects images, text and truncated buffers', () => {
    expect(sniffVideo(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
    expect(sniffVideo(Buffer.from('<html><script>1</script></html>'))).toBeNull();
    expect(sniffVideo(Buffer.alloc(0))).toBeNull();
    expect(sniffVideo(mp4Bytes().subarray(0, 6))).toBeNull();
  });
});
