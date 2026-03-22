# Deployment

This repo now includes a production-ready baseline for a single server deployment:

- `next build` generates a standalone server bundle.
- `Dockerfile` builds and runs the app in production mode.
- `docker-compose.production.yml` starts the container with restart policies.
- `/api/health` gives a simple health check for Docker or a reverse proxy.

## Recommended baseline

Use a Linux VPS with Docker and a reverse proxy in front of the app:

- App container listens on port `3000`
- Nginx or Caddy terminates HTTPS on `443`
- Supabase stays managed remotely
- OpenAI is used through `OPENAI_API_KEY`

This is the fastest path to getting the app reachable on a real server without changing the product architecture.

## Production env file

Create a server-side `.env.production` from `.env.production.example`.

Required values:

- `NEXT_PUBLIC_SITE_URL=https://your-domain`
- `NEXT_PUBLIC_SUPABASE_URL=...`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY=...`
- `SUPABASE_SERVICE_ROLE_KEY=...`
- `OPENAI_API_KEY=...`

Recommended production values:

- Leave `PREVIEW_AUTH_BYPASS` empty or unset
- Add `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` if you want external Inngest delivery

## Supabase auth config

Before you switch traffic to production, update Supabase Auth settings:

- Site URL: `https://your-domain`
- Redirect URL: `https://your-domain/auth/callback`

If Google or Apple login is enabled, make sure those providers also use the same production callback base URL.

## Build and run with Docker Compose

On the server:

```bash
cp .env.production.example .env.production
docker compose -f docker-compose.production.yml build
docker compose -f docker-compose.production.yml up -d
```

Then verify:

```bash
curl http://127.0.0.1:3000/api/health
```

## Reverse proxy

Point your reverse proxy to `http://127.0.0.1:3000`.

Minimum requirements:

- Redirect `http` to `https`
- Forward `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`
- Keep request body size high enough for audio and PDF uploads

For Nginx, set `client_max_body_size` high enough for your expected uploads.

## Deploy update flow

When you ship a new version:

```bash
git pull
docker compose -f docker-compose.production.yml build
docker compose -f docker-compose.production.yml up -d
```

## What still needs a follow-up decision

This baseline gets the app onto one server. The next deployment decisions are operational, not code-level:

- Which domain to use
- Which VPS provider to use
- Whether to keep background jobs in-process or wire up hosted Inngest
- Which reverse proxy you want on the box
- Whether uploads need stricter body-size, timeout, and rate-limit rules
