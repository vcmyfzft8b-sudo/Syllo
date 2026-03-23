alter table public.lectures
  add column if not exists processing_metadata jsonb not null default '{}'::jsonb;
