create table if not exists public.lecture_study_sections (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  idx integer not null,
  title text not null,
  source_label text,
  source_start_ms bigint,
  source_end_ms bigint,
  source_page_start integer,
  source_page_end integer,
  unit_start_idx integer not null,
  unit_end_idx integer not null,
  card_count integer not null default 0,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create unique index if not exists lecture_study_sections_lecture_idx_unique
  on public.lecture_study_sections (lecture_id, idx);

alter table public.flashcards
  add column if not exists section_id uuid references public.lecture_study_sections (id) on delete cascade,
  add column if not exists source_unit_idx integer not null default 0,
  add column if not exists card_kind text not null default 'recall',
  add column if not exists concept_key text not null default '',
  add column if not exists source_type text not null default 'audio',
  add column if not exists source_locator text,
  add column if not exists coverage_rank integer not null default 0;

alter table public.lecture_study_sections enable row level security;

create policy "lecture_study_sections_select_own"
  on public.lecture_study_sections
  for select
  using (
    exists (
      select 1
      from public.lectures
      where lectures.id = lecture_study_sections.lecture_id
        and lectures.user_id = auth.uid()
    )
  );
