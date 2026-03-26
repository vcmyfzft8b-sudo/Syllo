# Memo

Memo is a note-taking and study app built with `Next.js`, `Supabase`, `OpenAI`, and `Inngest`.

It turns source material into structured notes, summaries, study tools, and lecture-grounded chat. The current app supports audio recording, audio upload, pasted text, PDFs, and links as note sources.

## Current feature set

- Email magic-link auth with Supabase
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

5. In Supabase Auth, enable the providers you want to use:

- Email
- Google
- Apple (optional)

For email code login, update the Supabase email template to include the OTP token placeholder such as `{{ .Token }}` so users receive a code they can type into the app. This repo includes local templates in [`supabase/templates/magic-link.html`](./supabase/templates/magic-link.html) and [`supabase/templates/confirmation.html`](./supabase/templates/confirmation.html).

6. Start the app:

```bash
npm run dev
```

7. Open `http://localhost:3000`.

## Environment notes

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are required for auth, storage, and server-side data access.
- `OPENAI_API_KEY` is required for transcription and AI generation.
- `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` are optional. Without them, the app can still run, but background processing behavior depends on the local fallback path already implemented in the codebase.
- The audio storage bucket is `lecture-audio` and is created by the initial migration.

## Important routes

- `/` landing and sign-in entry
- `/app` note library
- `/app?mode=record|upload|link|text` create-note entry points
- `/app/lectures/[id]` note workspace
- `/app/support` help center
- `/app/settings` account and sharing settings
- `/api/inngest` background job endpoint

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
