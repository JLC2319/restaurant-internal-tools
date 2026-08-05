import { Router } from 'express';
import multer from 'multer';
import { MAX_PHOTO_BYTES } from '@rit/shared';
import * as mediaController from './media.controller';
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
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
});

mediaRouter.use(authenticate, resolveTenant);

mediaRouter.post(
  '/photos',
  requireRole('chef'),
  uploadRateLimiter,
  upload.single('file'),
  mediaController.uploadPhoto
);

mediaRouter.delete('/:id', requireRole('chef'), mediaController.deleteAsset);

export { mediaRouter };
