# Deploy To Vercel

Vercel is the simplest production target for this app because it is already a standard Next.js App Router project.

## Before you deploy

You need:

- a Vercel account
- a Supabase project with the existing migrations applied
- an OpenAI API key
- a real production domain or a Vercel preview URL to test against

Recommended for production:

- configure Inngest so note generation, flashcards, and quizzes run out-of-band instead of relying on in-process fallback execution

## Important app constraints on Vercel

- PDF uploads are capped at `4 MB` in the app to stay below Vercel's function request-body limit
- long-running AI routes now export `maxDuration = 300`
- audio uploads are already safe because the app uploads audio directly to Supabase Storage using signed upload URLs

If you want larger PDF uploads later, the fix is architectural: upload PDFs to storage first, then process them asynchronously from storage instead of posting the file through `/api/lectures/pdf`.

## Create the Vercel project

1. Push this repo to GitHub.
2. In Vercel, import the repository as a new project.
3. Keep the framework preset as `Next.js`.
4. Deploy once with env vars configured.

You do not need a custom `vercel.json` for the current setup.

## Set production environment variables

Add these in the Vercel project settings:

- `NEXT_PUBLIC_SITE_URL=https://your-domain`
- `NEXT_PUBLIC_SUPABASE_URL=...`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY=...`
- `SUPABASE_SERVICE_ROLE_KEY=...`
- `OPENAI_API_KEY=...`
- `OPENAI_TEXT_MODEL=gpt-4.1-mini`
- `OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe-diarize`
- `OPENAI_EMBEDDING_MODEL=text-embedding-3-small`

Strongly recommended on Vercel:

- `INNGEST_EVENT_KEY=...`
- `INNGEST_SIGNING_KEY=...`

Do not enable this in production:

- `PREVIEW_AUTH_BYPASS`

## Update Supabase auth settings

In Supabase Auth:

- Site URL: `https://your-domain`
- Redirect URL: `https://your-domain/auth/callback`

If Google or Apple auth is enabled, update those provider settings to use the same production callback base URL.

## Deploy

After the env vars are set, deploy from Vercel.

Then verify:

- `/`
- `/api/health`
- email login flow
- Google login flow, if enabled
- audio upload flow
- text and link note creation
- PDF note creation with a file under `4 MB`

## Domain setup

When the app works on the Vercel deployment URL:

1. add the custom domain in Vercel
2. point DNS to Vercel
3. update `NEXT_PUBLIC_SITE_URL`
4. update Supabase Auth Site URL and redirect URL again if the domain changed

## Recommended production shape

For a stable Vercel production deployment, use:

- Vercel for the Next.js app
- Supabase for auth, database, and storage
- Inngest for background work
- OpenAI for transcription and generation
