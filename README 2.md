# Memo

Memo is an AI note-taking and study app for lectures, recordings, documents, and pasted material. It turns source content into transcripts, structured notes, flashcards, quizzes, practice tests, exports, and lecture-grounded chat.

The canonical production domain is `https://memoai.eu`.

## What the app does

- Sign in with Supabase Auth using email OTP, Google, or Apple
- Create lecture workspaces from:
  - in-browser audio recording
  - uploaded audio files
  - pasted text
  - links / web sources
  - PDFs and other supported document files
  - manual note input
- Transcribe long audio and preserve chunk metadata for processing
- Generate summaries, structured notes, flashcards, quizzes, and practice tests
- Chat against lecture-specific notes and transcript context
- Export notes as PDF
- Organize lectures into folders and manage retry / regeneration flows
- Gate paid actions behind onboarding plus Stripe billing

## Stack

- `Next.js` 16 App Router
- `React` 19
- `TypeScript`
- `Tailwind CSS` 4
- `Supabase` for Auth, Postgres, Storage, and RLS
- `Stripe` for subscriptions and billing portal
- `Inngest` for background jobs when configured
- AI providers:
  - `OpenAI`
  - `Google Gemini`
  - `Soniox` for transcription

## Project structure

- `src/app` routes, layouts, auth screens, and API handlers
- `src/components` app shell, capture flows, lecture workspace, and study UI
- `src/lib` business logic, AI integrations, billing, validation, and helpers
- `src/inngest` Inngest client and function wiring
- `supabase/migrations` database schema and feature migrations
- `docs` deployment notes for Vercel and Docker / VPS hosting

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` in the project root.

Minimum required:

```bash
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

3. Configure at least one AI provider.

OpenAI:

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_TEXT_MODEL=gpt-4.1-mini
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe-diarize
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

Gemini:

```bash
AI_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_TEXT_MODEL=gemini-2.5-flash-lite
GEMINI_TRANSCRIPTION_MODEL=gemini-2.5-flash
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
```

Optional transcription override:

```bash
TRANSCRIPTION_PROVIDER=openai
# or gemini
# or soniox
SONIOX_API_KEY=...
SONIOX_MODEL=stt-async-v4
```

4. Add billing and job-processing env vars as needed:

```bash
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_WEEKLY=
STRIPE_PRICE_MONTHLY=
STRIPE_PRICE_YEARLY=
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
INTERNAL_JOB_SECRET=
```

Notes:

- If `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` are set, the app uses Inngest for background jobs.
- If Inngest is not configured but `NEXT_PUBLIC_SITE_URL` and `INTERNAL_JOB_SECRET` are set, the app uses internal background-job routes.
- If neither path is configured, some generation work falls back to in-process execution.

5. Create a Supabase project and apply the SQL migrations in `supabase/migrations` in order.

6. Start the dev server:

```bash
npm run dev
```

7. Open `http://localhost:3000`.

## Auth and Supabase config

Enable the auth providers you need in Supabase:

- Email
- Google
- Apple

For the in-app email code flow, use an email template that includes `{{ .Token }}` so users receive a code they can type into the app. Local templates live in [supabase/templates/magic-link.html](/Users/nacevalencic/Desktop/note_taking_app_slo/supabase/templates/magic-link.html) and [supabase/templates/confirmation.html](/Users/nacevalencic/Desktop/note_taking_app_slo/supabase/templates/confirmation.html).

For production:

- Set Supabase Auth Site URL to `https://memoai.eu`
- Add `https://memoai.eu/auth/callback` to redirect URLs
- Use a real SMTP provider for email delivery
- Treat `notetakingappslo.vercel.app` as deprecated

## Billing

Paid actions are gated behind `/app/start`, which combines onboarding questions with the Stripe paywall.

Current plan values in code:

- Weekly: `€9`
- Monthly: `€18`
- Yearly: `€119`

To set up Stripe:

1. Create recurring Stripe prices for weekly, monthly, and yearly plans.
2. Set `STRIPE_SECRET_KEY`.
3. Run:

```bash
npm run stripe:setup
```

4. Copy the generated price IDs and webhook secret into your environment.
5. Set `STRIPE_WEBHOOK_URL` if your public site domain redirects and Stripe should post to a different final host.
6. Point Stripe webhooks at the final non-redirecting `/api/stripe/webhook` URL.

## Important routes

- `/` marketing and auth entry
- `/app` lecture library
- `/app/start` onboarding and subscription gate
- `/app/lectures/[id]` lecture workspace
- `/app/settings` account and billing settings
- `/app/support` help center
- `/api/health` health check
- `/api/inngest` Inngest endpoint
- `/api/stripe/webhook` Stripe sync endpoint

## Scripts

- `npm run dev` start local development
- `npm run dev:turbopack` start development with Turbopack
- `npm run build` create a production build
- `npm run start` run the production server
- `npm run lint` run ESLint
- `npm run stripe:setup` bootstrap Stripe product, prices, portal, and webhook

## Verification

```bash
npm run lint
npm run build
```

If you only want to lint the source tree, use:

```bash
npx eslint src
```

## Deployment

Deployment guides:

- [docs/deploy-vercel.md](/Users/nacevalencic/Desktop/note_taking_app_slo/docs/deploy-vercel.md)
- [docs/deploy.md](/Users/nacevalencic/Desktop/note_taking_app_slo/docs/deploy.md)

Relevant deployment files:

- [Dockerfile](/Users/nacevalencic/Desktop/note_taking_app_slo/Dockerfile)
- [docker-compose.production.yml](/Users/nacevalencic/Desktop/note_taking_app_slo/docker-compose.production.yml)
- [next.config.ts](/Users/nacevalencic/Desktop/note_taking_app_slo/next.config.ts)
- [.env.production.example](/Users/nacevalencic/Desktop/note_taking_app_slo/.env.production.example)

When deploying, prefer `NEXT_PUBLIC_SITE_URL=https://memoai.eu` for production unless you are intentionally targeting another domain.

## Notes

- The repository name is still `note_taking_app_slo`, but the product brand is `Memo`.
- The app resolves site URLs from `NEXT_PUBLIC_SITE_URL` and forwarded request headers, so keeping production URLs centralized matters.
