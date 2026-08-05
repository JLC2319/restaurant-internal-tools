# `media` — not yet implemented

Plating photos and training video: upload, storage, transcoding, CDN delivery.
Listed as a hard technical constraint in the planning doc.

## Files to create

```
media.model.ts       Asset records (key, mime, size, dimensions, owner scope)
media.service.ts     R2 put/delete, signed URLs
media.controller.ts
media.router.ts      multer memory storage → validate → upload
```

Mount in `app.ts` as `/api/media`.

## Rules

- **Derive the file extension from the server-validated MIME type, never from
  the client's filename.** Extension spoofing is the standard upload attack.
- Store assets under a tenant-prefixed key (`{orgId}/{propertyId}/…`) so a
  misconfigured bucket policy fails closed per tenant rather than globally.
- Put `uploadRateLimiter` on every upload route.
- Photos can go straight to R2. **Video needs a transcode step** — do not block
  the request on it; record the asset as `processing` and let the reader app
  handle that state.
- Config lives in `env.r2*`; all of it is optional, so guard the feature behind a
  check that the bucket is configured rather than throwing at import time.
