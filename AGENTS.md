# Project Instructions

- Production domain: `https://memoai.eu` is the canonical live app domain.
- When adding or updating hardcoded production URLs, use `https://memoai.eu`, not legacy Vercel domains.
- Prefer `NEXT_PUBLIC_SITE_URL` or another central config for app URLs when the target supports configuration.
- Treat `notetakingappslo.vercel.app` as deprecated unless a task explicitly requires it.

## Git And Deployment Workflow

- Use a single GitHub repository for this project. Do not create a second repo for testing work.
- Treat `main` as the production branch. Only production-ready code should be merged into `main`.
- For every new feature, bug fix, refactor, or experiment, create a separate branch before making code changes.
- Branch names should be descriptive, for example: `fix/login-redirect`, `feature/flashcards-export`, `chore/update-copy`.
- Agents should make changes on the current non-`main` branch when one already exists for the task. If work starts on `main`, create a new branch first unless the user explicitly asks otherwise.
- Test changes locally first with the normal local development workflow.
- After local testing, agents may prepare commits on the branch, but they must not push to GitHub unless the user explicitly asks for that push.
- The user is the default person responsible for pushing branches to GitHub and opening or merging pull requests.
- Use Vercel Preview Deployments to test branch work on the web before merging to `main`.
- Do not treat a Vercel preview URL as the production URL. Production remains `https://memoai.eu`.
- Merge to `main` only after the branch has been checked locally and in its Vercel preview deployment.

## Vercel Preview Rule

- Every pushed branch should be expected to get its own Vercel preview deployment when the GitHub repo is connected to Vercel.
- The preview deployment URL is where branch work should be reviewed on the web.
- The custom production domain `https://memoai.eu` should point only to the production deployment from `main`, unless the user explicitly requests a temporary branch domain strategy.

## Documentation

- Follow the workflow in [docs/development-workflow.md](/Users/nacevalencic/Desktop/note_taking_app_slo/docs/development-workflow.md) for branching, GitHub pushes, Vercel previews, and merging to production.
