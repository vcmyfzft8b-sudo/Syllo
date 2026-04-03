# Deploy To Vercel

Vercel is the simplest production target for this app because it is already a standard Next.js App Router project.

## Before you deploy

You need:

- a Vercel account
- a Supabase project with the existing migrations applied
- a Gemini API key
- a real production domain or a Vercel preview URL to test against

Recommended for production:

- configure Inngest so note generation, flashcards, and quizzes run out-of-band instead of relying on in-process fallback execution

## Important app constraints on Vercel

- PDF uploads are capped at `4 MB` in the app to stay below Vercel's function request-body limit
- long-running AI routes now export `maxDuration = 300`
- audio uploads are already safe because the app uploads audio directly to Supabase Storage using signed upload URLs
- server-side long-audio chunking depends on `ffmpeg`; standard Vercel Next.js functions should not be assumed to provide it

If you want larger PDF uploads later, the fix is architectural: upload PDFs to storage first, then process them asynchronously from storage instead of posting the file through `/api/lectures/pdf`.
If you want guaranteed long-audio chunking in production, move transcription work to infrastructure where `ffmpeg` is installed, or provide a bundled runtime that includes it.

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
- `GEMINI_API_KEY=...`
- `GEMINI_TEXT_MODEL=gemini-2.5-flash-lite`
- `GEMINI_EMBEDDING_MODEL=gemini-embedding-001`
- `SONIOX_API_KEY=...`
- `SONIOX_MODEL=stt-async-v4`

Strongly recommended on Vercel:

- `INNGEST_EVENT_KEY=...`
- `INNGEST_SIGNING_KEY=...`

If you are not wiring hosted Inngest yet, also set:

- `INTERNAL_JOB_SECRET=` a long random secret used for internal background-job routes

Do not enable this in production:

- `PREVIEW_AUTH_BYPASS`

## Update Supabase auth settings

In Supabase Auth:

- Site URL: `https://your-domain`
- Redirect URL: `https://your-domain/auth/callback`

If Google or Apple auth is enabled, update those provider settings to use the same production callback base URL.

For Google sign-in in Supabase:

- create a Google OAuth client for your production domain
- add your Vercel production domain and custom domain to the Google OAuth authorized JavaScript origins if you use both during rollout
- add Supabase's Google callback URL from the Supabase dashboard to the Google OAuth authorized redirect URIs
- paste the Google client ID and secret into Supabase Auth provider settings

If you want in-app email code entry instead of magic links, update the Supabase email template to send the OTP token placeholder like `{{ .Token }}`.

Temporary testing note: if you wire SMTP with a personal sender for short-term testing, replace it before production with a branded sender on a verified domain such as `no-reply@your-domain`. Do not ship live auth email from a personal mailbox.

For email code sign-in at production volume:

- configure Supabase Auth SMTP with a real provider such as Resend, Postmark, or SendGrid
- use a verified sending domain and a branded sender like `no-reply@your-domain`
- keep the email template using `{{ .Token }}` so users receive a code they can type into the app

## Deploy

After the env vars are set, deploy from Vercel.

Important:

- set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the `Preview` environment too, not only `Production`
- if these are missing in Preview, the login page will intentionally disable auth options for that preview deployment

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
5. update your SMTP sender domain and Google OAuth allowed origins if they still point at the temporary Vercel domain

## Recommended production shape

For a stable Vercel production deployment, use:

- Vercel for the Next.js app
- Supabase for auth, database, and storage
- Inngest for background work
- Gemini for generation and embeddings
- Soniox for transcription if enabled
