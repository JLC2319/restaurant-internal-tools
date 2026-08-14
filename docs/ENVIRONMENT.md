# Environment Variables

Every variable each app reads, with defaults. Local setup instructions —
runtimes, database, simulators — are in [DEVELOPMENT.md](DEVELOPMENT.md).

### API (`apps/api/.env`)

| Variable                        | Required | Default                 | Notes                                                                                                                                                       |
| ------------------------------- | -------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`                   | ✅       | —                       | MongoDB URI                                                                                                                                                 |
| `JWT_SECRET`                    | ✅       | —                       | High-entropy random string                                                                                                                                  |
| `JWT_EXPIRES_IN`                |          | `7d`                    | Token lifetime                                                                                                                                              |
| `PORT`                          |          | `9317`                  | Listen port                                                                                                                                                 |
| `NODE_ENV`                      |          | `development`           | Affects morgan format; `test` skips rate limiters                                                                                                           |
| `CORS_ORIGIN`                   |          | (empty)                 | Comma-separated allowed origins in production                                                                                                               |
| `TRUST_PROXY`                   |          | `1`                     | Reverse-proxy hops. Drives `req.ip`, which every rate limiter keys on. Never `true` — clients could then forge `X-Forwarded-For` and pick their own bucket. |
| `WEB_URL`                       |          | `http://localhost:6218` | Used for links in outbound mail                                                                                                                             |
| `ANTHROPIC_API_KEY`             |          | (empty)                 | Enables the LLM features (translation, recipe drafting). All off when unset.                                                                                |
| `LLM_MODEL`                     |          | `claude-sonnet-5`       | Model for every LLM call                                                                                                                                    |
| `TRANSLATION_ENABLED`           |          | `true`                  | Set `false` to disable machine translation without removing the key                                                                                         |
| `AI_DRAFTING_ENABLED`           |          | `true`                  | Set `false` to disable AI recipe drafting without removing the key                                                                                          |
| `CLOUDFLARE_ACCOUNT_ID`, `R2_*` |          | (empty)                 | Media storage                                                                                                                                               |

### Web (`apps/web/.env`)

| Variable              | Default                 | Notes                     |
| --------------------- | ----------------------- | ------------------------- |
| `PUBLIC_API_BASE_URL` | `http://localhost:9317` | Must start with `PUBLIC_` |

### Admin (`apps/admin/.env`)

| Variable              | Default                 | Notes                        |
| --------------------- | ----------------------- | ---------------------------- |
| `PUBLIC_API_BASE_URL` | `http://localhost:9317` | Same API as the customer app |

### Mobile (`apps/mobile/.env`)

| Variable                   | Default                 | Notes                                                                          |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| `EXPO_PUBLIC_API_BASE_URL` | `http://localhost:9317` | `localhost` works on a simulator; a physical device needs the machine's LAN IP |
