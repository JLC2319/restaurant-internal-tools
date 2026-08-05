import { PassThrough } from 'node:stream';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { Request } from 'express';
import type { StorageEngine } from 'multer';
import { env } from '../../config/env';
import { AppError } from '../../lib/AppError';
import { sniffVideo } from '../../lib/videoMeta';
import { scopeForWrite } from '../../lib/scope';
import { buildKey, s3 } from './media.service';

/**
 * A multer storage engine that streams a training video to R2 as it arrives.
 *
 * This is the whole reason videos are not handled like photos: memory storage
 * would buffer up to MAX_VIDEO_BYTES (512MB) of request body per upload, so a
 * couple of concurrent uploads could take the API down. Here the request body
 * flows through a fixed-size window instead:
 *
 *   request ──► sniff window (first ~4KB) ──► PassThrough ──► multipart R2 upload
 *
 * `Upload` from @aws-sdk/lib-storage chunks the stream into 8MB parts with two
 * in flight, so peak memory per upload is ~16MB regardless of file size, and
 * backpressure propagates all the way to the client socket. Delivery needs no
 * work at all: the R2 CDN origin answers HTTP range requests, which is what
 * `<video>` uses to seek and stream playback.
 *
 * The sniff window is the same security boundary photos go through — the
 * container is decided from the file's own first bytes (`sniffVideo`), never
 * the client's Content-Type, and rejection happens before anything is stored.
 *
 * Failure map:
 * - not MP4/WebM            → 415 before the upload starts; nothing stored.
 * - over MAX_VIDEO_BYTES    → multer truncates the stream and errors
 *                             LIMIT_FILE_SIZE (→ 413); the just-completed
 *                             partial object is deleted via `_removeFile`.
 * - client disconnects      → the part upload aborts; lib-storage cleans up
 *                             the incomplete multipart upload.
 * - R2 errors               → 502, incomplete multipart aborted by lib-storage.
 */

const SNIFF_BYTES = 4096;

/** ~16MB in flight per upload: two 8MB parts. R2's minimum part size is 5MB. */
const PART_SIZE = 8 * 1024 * 1024;
const PART_QUEUE = 2;

class R2VideoStorage implements StorageEngine {
  _handleFile(
    req: Request,
    file: Express.Multer.File,
    cb: (error?: unknown, info?: Partial<Express.Multer.File>) => void
  ): void {
    const ctx = req.tenant;
    if (!ctx) {
      cb(new AppError('Unauthorized', 401));
      return;
    }

    const stream = file.stream;
    let settled = false;
    let sawEnd = false;

    const fail = (err: unknown): void => {
      if (settled) return;
      settled = true;
      // Drain whatever the client is still sending so the request can finish
      // and the error response actually reaches them.
      stream.resume();
      cb(err);
    };

    // ── Phase 1: collect the sniff window ────────────────────────────────────
    const head: Buffer[] = [];
    let headLen = 0;

    const onHeadData = (chunk: Buffer): void => {
      head.push(chunk);
      headLen += chunk.length;
      if (headLen >= SNIFF_BYTES) {
        stream.off('data', onHeadData);
        stream.off('end', onHeadEnd);
        stream.pause();
        beginUpload(false);
      }
    };
    /** Files smaller than the window still get sniffed with what arrived. */
    const onHeadEnd = (): void => {
      stream.off('data', onHeadData);
      sawEnd = true;
      beginUpload(true);
    };

    // ── Phase 2: stream to R2 ────────────────────────────────────────────────
    const beginUpload = (ended: boolean): void => {
      const headBuf = Buffer.concat(head);
      const meta = sniffVideo(headBuf);
      if (!meta) {
        fail(new AppError('That file is not an MP4 or WebM video', 415));
        return;
      }

      const key = buildKey(scopeForWrite(ctx), meta.ext);
      const body = new PassThrough();
      let size = headLen;

      body.write(headBuf);
      if (ended) {
        body.end();
      } else {
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
        });
        stream.once('end', () => {
          sawEnd = true;
        });
        stream.pipe(body);
      }

      const upload = new Upload({
        client: s3(),
        params: {
          Bucket: env.r2BucketName,
          Key: key,
          Body: body,
          ContentType: meta.mime,
          // Keys are random and never reused, so a stored object is immutable.
          CacheControl: 'public, max-age=31536000, immutable',
        },
        partSize: PART_SIZE,
        queueSize: PART_QUEUE,
      });

      upload.done().then(
        () => {
          if (settled) return;
          settled = true;
          cb(null, { r2Key: key, r2Mime: meta.mime, r2Size: size });
        },
        (err: unknown) => {
          // lib-storage has already aborted the incomplete multipart upload.
          if (err instanceof AppError) {
            fail(err);
            return;
          }
          console.error('R2 video upload failed', err);
          fail(new AppError('Could not store that video. Please try again.', 502));
        }
      );

      // A client disconnect surfaces as 'error' or as 'close' without 'end' —
      // either way, poison the body so the part upload aborts promptly instead
      // of waiting forever for bytes that will never come.
      stream.once('error', (err) => body.destroy(err));
      stream.once('close', () => {
        if (!sawEnd) body.destroy(new Error('Upload connection closed early'));
      });
    };

    stream.on('data', onHeadData);
    stream.once('end', onHeadEnd);
    stream.once('error', (err) => fail(err));
    stream.once('close', () => {
      if (!sawEnd) fail(new AppError('Upload was interrupted', 400));
    });
  }

  /**
   * Called by multer to undo a completed store — which happens exactly when
   * the file finished uploading but the request as a whole failed, e.g. the
   * size limit tripped on the final chunk. Best-effort: an object the record
   * never points at is unreachable either way.
   */
  _removeFile(
    _req: Request,
    file: Express.Multer.File,
    cb: (error: Error | null) => void
  ): void {
    if (!file.r2Key) {
      cb(null);
      return;
    }
    s3()
      .send(new DeleteObjectCommand({ Bucket: env.r2BucketName, Key: file.r2Key }))
      .then(
        () => cb(null),
        (err: unknown) => {
          console.error('R2 delete failed for key', file.r2Key, err);
          cb(null);
        }
      );
  }
}

export const r2VideoStorage = new R2VideoStorage();
