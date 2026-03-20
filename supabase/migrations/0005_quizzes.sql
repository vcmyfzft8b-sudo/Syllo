create table if not exists public.lecture_quiz_assets (
  lecture_id uuid primary key references public.lectures (id) on delete cascade,
  status text not null default 'queued' check (
    status in ('queued', 'generating', 'ready', 'failed')
  ),
  error_message text,
  model_metadata jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  idx integer not null,
  prompt text not null,
  options_json jsonb not null default '[]'::jsonb,
  correct_option_idx integer not null check (
    correct_option_idx between 0 and 3
  ),
  explanation text not null,
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  source_locator text,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create unique index if not exists quiz_questions_lecture_idx_unique
  on public.quiz_questions (lecture_id, idx);

drop trigger if exists lecture_quiz_assets_set_updated_at on public.lecture_quiz_assets;

create trigger lecture_quiz_assets_set_updated_at
before update on public.lecture_quiz_assets
for each row execute procedure public.set_updated_at();

alter table public.lecture_quiz_assets enable row level security;
alter table public.quiz_questions enable row level security;

create policy "lecture_quiz_assets_select_own"
  on public.lecture_quiz_assets
  for select
  using (
    exists (
      select 1
      from public.lectures
      where lectures.id = lecture_quiz_assets.lecture_id
        and lectures.user_id = auth.uid()
    )
  );

create policy "quiz_questions_select_own"
  on public.quiz_questions
  for select
  using (
    exists (
      select 1
      from public.lectures
      where lectures.id = quiz_questions.lecture_id
        and lectures.user_id = auth.uid()
    )
  );
