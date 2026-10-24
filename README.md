# TokenExchange

A token wholesale and resale platform. You buy model capacity upstream, and customers use one API key
to call OpenAI, Anthropic and Gemini models. Requests are billed by token and routed across upstream
sources you buy from: official vendors, cloud platforms and resellers.

> Written from scratch against the vendors' public API documentation. **Contains no code from new-api or one-api**,
> so their AGPL / attribution terms do not apply. Licensed under [MIT](LICENSE).

**What's included**
- Public site: landing page, pricing (generated from the price table), integration docs, terms and privacy templates
- Self-service accounts: sign-up, email verification, password reset, optional Cloudflare Turnstile
- Customer console: balance, daily spend, API keys (spending caps, model allow-lists), usage history, Stripe top-ups,
  redeem codes, a billed web Playground, two-factor auth with recovery codes, low-balance email, English / 中文
- Billing safety: every request holds its worst-case cost before calling upstream and the output is capped to what
  was held, so concurrent requests cannot overdraw; per-key and per-user rate limits
- Pricing: per-token with cache read/write, long-context tiers, per-unit (images, searches, minutes), customer
  pricing groups (e.g. wholesale discounts)
- Admin console: channels (with live test, auto-disable and automatic recovery), prices, routing (source toggles,
  channel affinity, protocol conversion), rate limits, users, pricing groups, redeem codes, balance adjustments,
  usage logs, audit log, margin dashboard; optional "require 2FA for admins"
- Sign-in: email + password, GitHub, Google; brute-force limits on every auth form
- See [docs/GAP_ANALYSIS.md](docs/GAP_ANALYSIS.md) for a feature comparison with new-api and the improvement backlog

## Endpoints

| Protocol | Endpoint | Client auth |
|---|---|---|
| OpenAI Chat Completions | `POST /v1/chat/completions` | `Authorization: Bearer sk-tx-…` |
| OpenAI Responses | `POST /v1/responses` | same |
| OpenAI Embeddings | `POST /v1/embeddings` | same |
| Anthropic Messages | `POST /v1/messages` | `x-api-key` or Bearer |
| Gemini | `POST /v1beta/models/{model}:generateContent` / `:streamGenerateContent` | `x-goog-api-key`, `?key=` or Bearer |
| Image generation | `POST /v1/images/generations` | Bearer |
| Text-to-speech / transcription | `POST /v1/audio/speech`, `POST /v1/audio/transcriptions` (multipart) | Bearer |
| Rerank | `POST /v1/rerank` | Bearer |
| Anthropic token counting (free) | `POST /v1/messages/count_tokens` | `x-api-key` or Bearer |
| Model list | `GET /v1/models` | any of the above |

`/v1/chat/completions` also serves Claude and Gemini models by translating to the Anthropic / Gemini APIs
(tools, images, streaming and usage included), so OpenAI-SDK-only clients can use every model.

Streaming and non-streaming are both supported, and both are billed from the upstream's own usage counts, including cache reads and writes and thinking tokens.

## Upstream sources (selectable in the admin console)

| Source | Provider types | Protocols served |
|---|---|---|
| **official** | OpenAI, Anthropic, Gemini API | each vendor's own protocol |
| **cloud** | Azure OpenAI, AWS Bedrock (Claude), Google Vertex AI (Claude + Gemini) | OpenAI / Anthropic / Gemini |
| **reseller** | Any OpenAI-compatible or Anthropic-compatible relay | OpenAI / Anthropic |

How routing works:
- A model must have a row in **Models & prices**. Only channels whose model list includes it are considered.
- Under **Routing** you can turn whole sources on or off, and restrict a single model to particular sources (e.g. `claude-opus-4-1: official, cloud`).
- Higher-priority channels are tried first; channels with equal priority are picked by weighted random.
- If a channel returns 401/403/404/408/409/429/5xx, the next channel is tried automatically (default: up to 3).
- 400-class client errors are returned to the caller unchanged and do not trigger a retry.

Billing: customer price = list price × model `markup`; upstream cost = list price × channel `cost multiplier`. The dashboard shows gross margin per source.
All amounts are stored as integer micro-USD.

## Local development

```bash
cp .env.example .env            # fill in DATABASE_URL, ENCRYPTION_KEY, SESSION_SECRET, ADMIN_*
npm install
npm run db:migrate
npm run db:seed                 # creates the admin and example prices (check them before going live)
npm run dev                     # http://localhost:3000/admin
```

Tests:

```bash
npm run lint && npm test        # type check + unit tests
npm run build && npm start &    # start the app first
npx tsx scripts/e2e.ts          # end-to-end against mock upstreams (truncates every table in the database)
```

## Deploying to Vercel

1. **Database**: create a Postgres database from the Vercel Marketplace (Neon or Supabase).
   - Point `DATABASE_URL` at the **pooled** connection string (Supabase port 6543 / Neon `-pooler`).
   - Point `DATABASE_URL_UNPOOLED` at the direct connection string.
2. **Environment variables**: in the Vercel project settings, add:
   - Required: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `ENCRYPTION_KEY`, `SESSION_SECRET`, `APP_URL`.
   - For payments: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
   - For email: `RESEND_API_KEY`, `EMAIL_FROM`.
   - Optional bot protection: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`.
   - Housekeeping cron: `CRON_SECRET` (Vercel Cron sends it to `/api/cron/maintenance`).
   - Optional: `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` for rate-limit counters; `GITHUB_CLIENT_ID` /
     `GITHUB_CLIENT_SECRET` and `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` for social sign-in.
   - See `.env.example` for what each one does.
   - Generate `ENCRYPTION_KEY` with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
   - **Do not change `ENCRYPTION_KEY` after deploying**, or the stored upstream credentials can no longer be decrypted.
3. Import this repository into Vercel. The framework is detected as Next.js automatically.
4. Migrations and the first admin are applied by the Vercel build itself (`vercel-build` runs `db:migrate`,
   then `db:seed`, then `next build`). Set `ADMIN_EMAIL` / `ADMIN_PASSWORD` (12+ characters) for the first deploy;
   you can delete them afterwards. To run them by hand instead:
   `DATABASE_URL_UNPOOLED=… ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run db:migrate && npm run db:seed`
5. **Stripe webhook**: in the Stripe dashboard, add an endpoint at `https://<your-domain>/api/stripe/webhook` that sends these events:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `charge.refunded`

   Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
6. Sign in at `/login` with the admin account (you will land on `/admin`) and set things up:
   - Add model prices.
   - Add channels, then use "Send test request" on each one.
   - Create a user, then create an API key for them.

### Vercel limits to know about

- **Function duration**: relay routes set `maxDuration = 300` (the Hobby maximum). On Pro you can raise it to 800 in each `src/app/v1*/**/route.ts`. Streams that run past the limit are cut off.
- **Request body ≤ 4.5 MB**: requests with large base64 images or files will be rejected by Vercel.
- **No WebSockets**: so the OpenAI Realtime API is not supported.
- **Region**: `vercel.json` defaults to `iad1` (US East), close to most upstreams. Change it to match where your database and customers are.
- **Disconnects**: if a client disconnects mid-stream, the function keeps reading the upstream response until it ends, so it can bill for the tokens the upstream already charged.

## Layout

```
src/relay/            gateway core: auth, routing, retries, streaming, usage extraction
src/relay/providers/  one builder per upstream type (SigV4, Google service accounts, Azure, …)
src/lib/              billing, credential encryption, sessions, settings
src/app/v1*/          API routes
src/app/admin/        admin console (channels, prices, routing, users / keys, logs)
scripts/              migrations, seed, mock upstreams and e2e test
docs/PLAN.md          roadmap
```
