create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc'::text, now()),
  user_id uuid references auth.users (id) on delete set null,
  lecture_id uuid references public.lectures (id) on delete set null,
  provider text not null,
  model text not null,
  stage text not null,
  attempt_index integer not null default 0,
  success boolean not null default true,
  prompt_token_count integer,
  candidates_token_count integer,
  thoughts_token_count integer,
  total_token_count integer,
  estimated_cost_usd numeric(12, 8),
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists ai_usage_events_created_at_idx
  on public.ai_usage_events (created_at desc);

create index if not exists ai_usage_events_user_created_at_idx
  on public.ai_usage_events (user_id, created_at desc);

create index if not exists ai_usage_events_lecture_created_at_idx
  on public.ai_usage_events (lecture_id, created_at desc);

create index if not exists ai_usage_events_model_created_at_idx
  on public.ai_usage_events (model, created_at desc);

alter table public.ai_usage_events enable row level security;
