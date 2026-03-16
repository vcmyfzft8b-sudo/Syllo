create table if not exists public.lecture_study_assets (
  lecture_id uuid primary key references public.lectures (id) on delete cascade,
  status text not null default 'queued' check (
    status in ('queued', 'generating', 'ready', 'failed')
  ),
  error_message text,
  model_metadata jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.flashcards (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  idx integer not null,
  front text not null,
  back text not null,
  hint text,
  citations_json jsonb not null default '[]'::jsonb,
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  created_at timestamptz not null default timezone('utc'::text, now())
);

create unique index if not exists flashcards_lecture_idx_unique
  on public.flashcards (lecture_id, idx);

create table if not exists public.flashcard_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  flashcard_id uuid not null references public.flashcards (id) on delete cascade,
  confidence_bucket text not null default 'again' check (
    confidence_bucket in ('again', 'good', 'easy')
  ),
  review_count integer not null default 0,
  last_reviewed_at timestamptz,
  primary key (user_id, flashcard_id)
);

drop trigger if exists lecture_study_assets_set_updated_at on public.lecture_study_assets;

create trigger lecture_study_assets_set_updated_at
before update on public.lecture_study_assets
for each row execute procedure public.set_updated_at();

alter table public.lecture_study_assets enable row level security;
alter table public.flashcards enable row level security;
alter table public.flashcard_progress enable row level security;

create policy "lecture_study_assets_select_own"
  on public.lecture_study_assets
  for select
  using (
    exists (
      select 1
      from public.lectures
      where lectures.id = lecture_study_assets.lecture_id
        and lectures.user_id = auth.uid()
    )
  );

create policy "flashcards_select_own"
  on public.flashcards
  for select
  using (
    exists (
      select 1
      from public.lectures
      where lectures.id = flashcards.lecture_id
        and lectures.user_id = auth.uid()
    )
  );

create policy "flashcard_progress_select_own"
  on public.flashcard_progress
  for select
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.flashcards
      join public.lectures on lectures.id = flashcards.lecture_id
      where flashcards.id = flashcard_progress.flashcard_id
        and lectures.user_id = auth.uid()
    )
  );

create policy "flashcard_progress_insert_own"
  on public.flashcard_progress
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.flashcards
      join public.lectures on lectures.id = flashcards.lecture_id
      where flashcards.id = flashcard_progress.flashcard_id
        and lectures.user_id = auth.uid()
    )
  );

create policy "flashcard_progress_update_own"
  on public.flashcard_progress
  for update
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.flashcards
      join public.lectures on lectures.id = flashcards.lecture_id
      where flashcards.id = flashcard_progress.flashcard_id
        and lectures.user_id = auth.uid()
    )
  );
