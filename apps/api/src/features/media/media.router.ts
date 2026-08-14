import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { MAX_PHOTO_BYTES, MAX_VIDEO_BYTES } from '@rit/shared';
import * as mediaController from './media.controller';
import { assertConfigured } from './media.service';
import { r2VideoStorage } from './videoStorage';
import { authenticate } from '../../middleware/authenticate';
import { resolveTenant, requireRole } from '../../middleware/resolveTenant';
import { uploadRateLimiter } from '../../middleware/rateLimiter';

const mediaRouter = Router();

/**
 * Memory storage: a photo goes straight to R2 and is never written to the API's
 * own disk. `limits` is the first line of defence — multer aborts the stream as
 * soon as it is exceeded, and `errorHandler` turns that into a 413 rather than
 * letting an oversized upload buffer in full first.
 *
 * One file per request. The content type is decided from the bytes in the
 * service, so nothing here trusts `file.mimetype`.
 */
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
});

/**
 * Videos never buffer: the storage engine streams the body to R2 with bounded
 * memory (see videoStorage.ts). The same size limit mechanics apply — multer
 * truncates at MAX_VIDEO_BYTES and the engine's partial object is removed.
 */
const videoUpload = multer({
  storage: r2VideoStorage,
  limits: { fileSize: MAX_VIDEO_BYTES, files: 1 },
});

/**
 * Photos check config in the service, *after* multer has buffered — harmless
 * at photo sizes. A video must refuse before the client streams half a
 * gigabyte at a server that cannot store it.
 */
function ensureConfigured(_req: Request, _res: Response, next: NextFunction): void {
  assertConfigured();
  next();
}

mediaRouter.use(authenticate, resolveTenant);

mediaRouter.post(
  '/photos',
  requireRole('chef'),
  uploadRateLimiter,
  photoUpload.single('file'),
  mediaController.uploadPhoto,
);

mediaRouter.post(
  '/videos',
  requireRole('chef'),
  uploadRateLimiter,
  ensureConfigured,
  videoUpload.single('file'),
  mediaController.uploadVideo,
);

mediaRouter.delete('/:id', requireRole('chef'), mediaController.deleteAsset);

export { mediaRouter };
