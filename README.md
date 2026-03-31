# Memo

Memo is a note-taking and study app built with `Next.js`, `Supabase`, `OpenAI`, and `Inngest`.

It turns source material into structured notes, summaries, study tools, and lecture-grounded chat. The current app supports audio recording, audio upload, pasted text, PDFs, and links as note sources.

## Current feature set

- Email OTP code auth with Supabase
- Google auth, plus Apple auth when enabled in Supabase
- Protected app shell for the note library
- Create notes from:
  - in-browser recording
  - uploaded audio
  - pasted text
  - PDF files
  - links / web sources
- Audio transcription with timestamped segments
- AI-generated summaries and structured notes
- Lecture-scoped chat grounded in transcript and note context
- Flashcards and quizzes generated from the note content
- PDF export
- Folder organization, rename, delete, and retry flows

## Stack

- `Next.js` 16 App Router
- `React` 19
- `Supabase` Auth, Postgres, Storage, RLS
- `OpenAI` for transcription, notes, embeddings, chat, flashcards, and quizzes
- `Inngest` for background processing
- `Tailwind CSS` 4

## Project structure

- `src/app` app routes, API routes, layout, and auth flows
- `src/components` app UI, note creation flows, workspace, study tools
- `src/lib` server logic, AI pipelines, Supabase helpers, and shared types
- `supabase/migrations` database schema and feature migrations

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` in the project root with:

```bash
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=...
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_WEEKLY=
STRIPE_PRICE_MONTHLY=
STRIPE_PRICE_YEARLY=

# Optional overrides
OPENAI_TEXT_MODEL=gpt-4.1-mini
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe-diarize
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
PREVIEW_AUTH_BYPASS=
```

3. Create a Supabase project.

4. Run the migrations in order:

- `supabase/migrations/0001_init.sql`
- `supabase/migrations/0002_flashcards.sql`
- `supabase/migrations/0003_lecture_delete_policy.sql`
- `supabase/migrations/0004_comprehensive_flashcards.sql`
- `supabase/migrations/0005_quizzes.sql`
- `supabase/migrations/0006_lecture_processing_metadata.sql`
- `supabase/migrations/0007_study_sessions.sql`
- `supabase/migrations/0008_email_auth_rate_limits.sql`
- `supabase/migrations/0009_api_rate_limits.sql`
- `supabase/migrations/0010_fix_consume_rate_limit_conflict.sql`
- `supabase/migrations/0011_practice_tests.sql`
- `supabase/migrations/0012_practice_test_attempt_snapshots.sql`
- `supabase/migrations/0013_billing_and_onboarding.sql`

5. In Supabase Auth, enable the providers you want to use:

- Email
- Google
- Apple (optional)

For email code login, update the Supabase email template to include the OTP token placeholder such as `{{ .Token }}` so users receive a code they can type into the app. This repo includes local templates in [`supabase/templates/magic-link.html`](./supabase/templates/magic-link.html) and [`supabase/templates/confirmation.html`](./supabase/templates/confirmation.html).

For production auth:

- set Supabase Auth Site URL to your real app domain
- add `https://your-domain/auth/callback` to Supabase redirect URLs
- configure a real SMTP sender in Supabase Auth so email codes can be delivered reliably at production volume
- configure Google in Supabase Auth with your production callback URL before exposing the button to users

6. Start the app:

```bash
npm run dev
```

7. Open `http://localhost:3000`.

## Billing flow

- After sign-in, the user can still browse the app.
- Paid actions redirect to `/app/start`: uploading or recording material, importing links or documents, and generating flashcards, quizzes, or practice tests.
- The first part of `/app/start` is a short personalization flow that stores onboarding answers in `public.profiles`.
- The second part is the Stripe paywall.
- Current plan prices:
  - weekly: `€9`
  - monthly: `€18`
  - yearly: `€119`

### Stripe setup

1. Create three recurring Stripe prices in `EUR`: weekly, monthly, and yearly.
2. Put `STRIPE_SECRET_KEY` in your environment.
3. Run `npm run stripe:setup` to create the product, the three prices, the billing portal configuration, and the webhook endpoint when one does not already exist.
4. Put the resulting price IDs, plus the webhook secret, into your environment.
5. If you prefer to do it manually, add a Stripe webhook endpoint for `/api/stripe/webhook`.
6. Subscribe the webhook to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
7. For local development, forward Stripe events to `http://localhost:3000/api/stripe/webhook` with the Stripe CLI.

## Environment notes

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are required for auth, storage, and server-side data access.
- `OPENAI_API_KEY` is required for transcription and AI generation.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_WEEKLY`, `STRIPE_PRICE_MONTHLY`, and `STRIPE_PRICE_YEARLY` are required for the subscription flow.
- `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` are optional. Without them, the app can still run, but background processing behavior depends on the local fallback path already implemented in the codebase.
- `INTERNAL_JOB_SECRET` is strongly recommended when `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` are not set, so internal background-job requests can still run safely via your deployed app URL.
- The audio storage bucket is `lecture-audio` and is created by the initial migration.

## Important routes

- `/` landing and sign-in entry
- `/app` note library
- `/app/start` onboarding and subscription gate
- `/app?mode=record|upload|link|text` create-note entry points
- `/app/lectures/[id]` note workspace
- `/app/support` help center
- `/app/settings` account and sharing settings
- `/api/inngest` background job endpoint
- `/api/stripe/webhook` Stripe subscription sync

## What the workspace includes

- Summary view
- Full structured notes
- Transcript view when transcript data exists
- Lecture-grounded chat
- Flashcard generation and review
- Quiz generation and multiple-choice review
- PDF export

## Verification

```bash
npm run dev
npx eslint src
npm run build
```

## Deployment

The repo includes two deployment paths:

- Vercel deployment guide in [`docs/deploy-vercel.md`](./docs/deploy-vercel.md)
- single-server Docker deployment guide in [`docs/deploy.md`](./docs/deploy.md)

Shared production pieces:

- standalone Next.js output in [`next.config.ts`](./next.config.ts)
- health check route at `/api/health`
- container build in [`Dockerfile`](./Dockerfile) for non-Vercel hosting

## Notes

- The repo currently contains generated Next output directories such as `.next` and `.next_old_1773694499528`. If global linting picks those up in your environment, lint the source tree directly with `npx eslint src`.
- The package name and Supabase local `project_id` still use the original repository identifier `note_taking_app_slo`. That is separate from the in-app Memo branding.
