# Development Workflow

This project uses one GitHub repository, local development for fast testing, and Vercel Preview Deployments for web testing before production.

## Simple Rule

- `main` = production
- feature or fix branches = work in progress
- Vercel preview URL = test branch on the web
- `https://memoai.eu` = live production site only

## Why This Setup

Use one repository instead of a separate testing repository.

That keeps:

- one codebase
- one source of truth
- simpler history
- simpler Vercel setup
- less risk of forgetting to copy changes between repos

## Standard Workflow

### 1. Start from `main`

Make sure your local `main` is up to date, then create a new branch for the task.

Example branch names:

- `fix/signup-error`
- `feature/quiz-improvements`
- `chore/update-vercel-config`

Example commands:

```bash
git checkout main
git pull origin main
git checkout -b fix/signup-error
```

### 2. Build and test locally

Do the work on that branch and test it on your Mac first.

Typical local workflow:

```bash
npm run dev
```

Open:

```bash
http://localhost:3000
```

This is the fastest way to check UI, logic, and basic behavior while you are developing.

### 3. Commit the work

When the branch is in a good state, commit the changes.

Example:

```bash
git add .
git commit -m "Fix signup redirect flow"
```

### 4. Push the branch to GitHub

Push the branch, not `main`.

Example:

```bash
git push -u origin fix/signup-error
```

Important:

- agents should not push automatically unless you explicitly ask them to
- by default, the user reviews the work first and pushes the branch manually
- when you push, push the current feature or fix branch, not `main`

### 5. Let Vercel create a Preview Deployment

If the GitHub repository is connected to Vercel, Vercel will automatically build that branch and create a preview URL.

That preview URL is how you see the branch version on the real web without affecting production.

Important:

- branch code does not need to be merged into `main` to be visible on the web
- it only needs to be pushed to GitHub
- Vercel builds it as a preview deployment

## How You See The App If It Is Not On `main`

You do not view branch work on `https://memoai.eu`.

Instead, you open the Vercel preview URL for that branch. It usually looks something like:

```text
https://branch-name-project-name.vercel.app
```

You can access it in several ways:

- from the Vercel dashboard under the project deployments
- from the GitHub pull request, where Vercel usually posts the preview link
- from the deployment activity in Vercel after pushing the branch

In practice, the easiest place to look is:

- Vercel dashboard -> your project -> Deployments

You will see a deployment for the branch, and that deployment page contains the preview link.

So the flow is:

- local machine for quick testing
- Vercel preview URL for real web testing
- `main` for production

## When To Merge To `main`

Merge only after:

- the feature or fix works locally
- the Vercel preview deployment works correctly
- any important environment-dependent behavior has been checked

After merge, Vercel deploys `main` to production, and production stays on:

```text
https://memoai.eu
```

The normal release flow is:

1. push your feature branch
2. open a pull request into `main`
3. review and test the Vercel preview
4. merge the pull request
5. let Vercel deploy `main` to production

## Recommended GitHub And Vercel Setup

In GitHub:

- keep one repository
- protect `main` if needed
- open a pull request for each branch before merging

In Vercel:

- connect the GitHub repository to one Vercel project
- let `main` be the Production Branch
- allow Preview Deployments for other branches

## Environment Variable Reminder

Production values should remain configured for the production environment.

Preview deployments may also need environment variables. In Vercel, set the required variables for:

- Production
- Preview
- Development, if needed

If a preview deployment is missing env vars, the branch may build but not work correctly.

## Rule For Agents

When an agent works on this repository, it should:

1. avoid direct work on `main` for features or fixes
2. create or use a task-specific branch
3. test locally first
4. prepare the branch for user review and wait for the user to push it
5. use the Vercel preview deployment for browser testing
6. merge to `main` only when the work is ready for production

## Optional Future Upgrade

If the team later wants a more structured flow, it can add:

- `develop` as a shared staging branch

For now, the recommended workflow is simpler:

- one repo
- `main` for production
- short-lived feature/fix branches
- Vercel previews for testing
