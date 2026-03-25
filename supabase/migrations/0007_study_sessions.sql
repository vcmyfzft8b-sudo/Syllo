create table if not exists public.lecture_study_sessions (
  user_id uuid not null references auth.users (id) on delete cascade,
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  active_study_view text not null default 'flashcards' check (
    active_study_view in ('flashcards', 'quiz')
  ),
  flashcard_state jsonb,
  quiz_state jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  primary key (user_id, lecture_id)
);

drop trigger if exists lecture_study_sessions_set_updated_at on public.lecture_study_sessions;

create trigger lecture_study_sessions_set_updated_at
before update on public.lecture_study_sessions
for each row execute procedure public.set_updated_at();

alter table public.lecture_study_sessions enable row level security;

create policy "lecture_study_sessions_select_own"
  on public.lecture_study_sessions
  for select
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.lectures
      where lectures.id = lecture_study_sessions.lecture_id
        and lectures.user_id = auth.uid()
    )
  );

create policy "lecture_study_sessions_insert_own"
  on public.lecture_study_sessions
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.lectures
      where lectures.id = lecture_study_sessions.lecture_id
        and lectures.user_id = auth.uid()
    )
  );

create policy "lecture_study_sessions_update_own"
  on public.lecture_study_sessions
  for update
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.lectures
      where lectures.id = lecture_study_sessions.lecture_id
        and lectures.user_id = auth.uid()
    )
  );
