# `media`

Tenant-scoped asset storage: plating photos and training videos. Mounted in
`app.ts` as `/api/media`.

## Shape

One collection, `Media` (`media.model.ts`): the scoped index of everything in
object storage — `kind`, `status`, the storage `key`, `mime`, `size`,
`width`/`height`, and `uploadedBy`. The bytes live in Cloudflare R2; nothing
reads the bucket directly, so an asset is findable, scopeable and revocable
through this collection alone.

Clients never see `key`. `shapeAsset` hands back an assembled `url` instead, so
the bucket layout stays ours to change.

## Routes

| Route                    | Role  | Notes                                                      |
| ------------------------ | ----- | ---------------------------------------------------------- |
| `POST /api/media/photos` | chef+ | multipart, field name `file`, one per request              |
| `POST /api/media/videos` | chef+ | multipart, field name `file`; **streamed**, never buffered |
| `DELETE /api/media/:id`  | chef+ | removes the record, then the object                        |

## Photos buffer; videos stream

A photo is a few MB, so multer's memory storage is fine: buffer, sniff, put. A
video is up to `MAX_VIDEO_BYTES` (512MB), so the same path would let two
concurrent uploads eat a gigabyte of API heap. `videoStorage.ts` is a custom
multer storage engine that pipes the request body through a ~4KB sniff window
straight into a multipart R2 upload (`@aws-sdk/lib-storage`, 8MB parts, two in
flight) — peak memory per upload is ~16MB regardless of file size, and
backpressure reaches the client socket.

Playback needs no API involvement either: the R2 CDN origin answers HTTP range
requests, which is exactly what `<video>` uses to start fast and seek. Videos
are `ready` on insert — MP4/WebM are directly streamable, and there is no
transcode pipeline yet for a `processing` state to wait on (QuickTime `.mov` is
rejected at sniff for that reason).

## The rules that matter

- **The bytes decide the format, never the client.** `lib/imageMeta.ts`
  (`sniffImage`) parses the file's own header and returns the MIME type,
  extension and dimensions; anything it cannot parse is a 415. The
  `Content-Type` header and the filename are both ignored. This is the reason a
  disguised SVG or HTML document cannot end up served from our CDN origin as a
  `.png` — that is stored XSS, not a cosmetic concern. It is dependency-free on
  purpose: `sharp` is a native build, and this reads four integers.
  `lib/videoMeta.ts` (`sniffVideo`) applies the same rule to the first bytes of
  a video stream: MP4 and WebM pass, QuickTime and Matroska do not.
- **Keys are tenant-prefixed** —
  `{orgId}/{propertyId|_}/{locationId|_}/{32 hex}.{ext}` — so a misconfigured
  bucket policy fails closed per tenant rather than globally. The basename is
  random; no part of the client's filename survives.
- **Attachment is scope-checked, not just existence-checked.**
  `assertPhotosAttachable` (recipes) and `assertAssetsAttachable` (training
  blocks, kind-aware) require an asset to sit at-or-above the scope of the
  document using it. Same rule as sub-recipes: a property recipe carrying one
  location's photo renders a broken image for every sibling location.
- **`uploadRateLimiter` is on every upload route**, and multer's `limits` abort
  an oversized stream before it buffers in full (`errorHandler` maps that to
  413).
- **The whole feature is optional.** `isMediaConfigured()` is checked at each
  entry point rather than throwing at import time, so an install with no R2
  credentials still boots — uploads answer 503 and everything else works.
- **Write order is deliberate.** The record is created only after the object
  lands, and on delete the record goes first. Both directions fail toward an
  orphaned object (harmless, sweepable) rather than a record pointing at
  nothing.

## Configuration

All of `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET_NAME` and `R2_PUBLIC_URL` must be set for the feature to enable.

Delivery is via a **public bucket URL / custom domain**, not presigned URLs. The
tradeoff: object keys are unguessable (128 bits of randomness) but not
access-controlled, in exchange for edge-cacheable images — which is what makes a
recipe page usable on kitchen wifi. If plating photos ever need true per-request
authorisation, swap `shapeAsset` for a presigned GET
(`@aws-sdk/s3-request-presigner`, not currently a dependency) and give the URLs
a TTL the reader app can refresh against.

## Still to build

- **Transcoding.** Uploads are stored and served as-is, which is why the sniff
  is strict about containers. A transcode pipeline (accept `.mov`/HEVC, emit
  H.264 MP4 + a poster frame) is the reason the `processing` status exists in
  the vocabulary; wire it in `recordVideoUpload` when it lands.
- **Orphan sweep.** Nothing currently reclaims objects whose upload succeeded
  but whose record insert failed, or whose R2 delete failed.
- **Derivatives.** Full-size phone photos (3–6MB) are served as uploaded today;
  the UI constrains them with CSS and `loading="lazy"`. A thumbnail pipeline is
  the first thing to add if the reader app feels heavy on a slow connection.
