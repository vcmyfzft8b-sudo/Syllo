create table if not exists public.lecture_tts_chunks (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  content_hash text not null,
  chunk_index integer not null,
  text text not null,
  word_start_index integer not null,
  word_end_index integer not null,
  language text not null,
  voice text not null,
  model text not null,
  audio_storage_path text not null,
  audio_mime_type text not null default 'audio/mpeg',
  duration_ms integer not null,
  alignment_json jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create unique index if not exists lecture_tts_chunks_cache_unique
  on public.lecture_tts_chunks (
    lecture_id,
    content_hash,
    chunk_index,
    language,
    voice,
    model
  );

create index if not exists lecture_tts_chunks_lecture_idx
  on public.lecture_tts_chunks (lecture_id, generated_at desc);

drop trigger if exists lecture_tts_chunks_set_updated_at on public.lecture_tts_chunks;
create trigger lecture_tts_chunks_set_updated_at
before update on public.lecture_tts_chunks
for each row execute procedure public.set_updated_at();

alter table public.lecture_tts_chunks enable row level security;

create policy "lecture_tts_chunks_select_own"
  on public.lecture_tts_chunks
  for select
  using (
    exists (
      select 1
      from public.lectures
      where lectures.id = lecture_tts_chunks.lecture_id
        and lectures.user_id = auth.uid()
    )
  );

create table if not exists public.tts_daily_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  usage_date date not null,
  seconds_used integer not null default 0,
  limit_seconds integer not null,
  updated_at timestamptz not null default timezone('utc'::text, now()),
  primary key (user_id, usage_date)
);

alter table public.tts_daily_usage enable row level security;

create policy "tts_daily_usage_select_own"
  on public.tts_daily_usage
  for select
  using (auth.uid() = user_id);

create table if not exists public.tts_play_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  session_id text not null,
  content_hash text not null,
  chunk_index integer not null,
  usage_date date not null,
  charged_seconds integer not null,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create unique index if not exists tts_play_events_idempotency_unique
  on public.tts_play_events (user_id, session_id, content_hash, chunk_index);

create index if not exists tts_play_events_user_date_idx
  on public.tts_play_events (user_id, usage_date, created_at desc);

alter table public.tts_play_events enable row level security;

create policy "tts_play_events_select_own"
  on public.tts_play_events
  for select
  using (auth.uid() = user_id);

create or replace function public.consume_tts_daily_quota(
  p_user_id uuid,
  p_lecture_id uuid,
  p_session_id text,
  p_content_hash text,
  p_chunk_index integer,
  p_usage_date date,
  p_seconds integer,
  p_limit_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usage public.tts_daily_usage%rowtype;
  v_existing_event public.tts_play_events%rowtype;
  v_remaining integer;
begin
  if p_seconds <= 0 or p_limit_seconds <= 0 then
    return jsonb_build_object(
      'allowed', false,
      'secondsUsed', 0,
      'remainingSeconds', 0,
      'limitSeconds', greatest(p_limit_seconds, 0),
      'code', 'invalid_quota_request'
    );
  end if;

  insert into public.tts_daily_usage (
    user_id,
    usage_date,
    seconds_used,
    limit_seconds
  )
  values (
    p_user_id,
    p_usage_date,
    0,
    p_limit_seconds
  )
  on conflict (user_id, usage_date) do update
  set limit_seconds = excluded.limit_seconds,
      updated_at = timezone('utc'::text, now());

  select *
  into v_usage
  from public.tts_daily_usage
  where user_id = p_user_id
    and usage_date = p_usage_date
  for update;

  select *
  into v_existing_event
  from public.tts_play_events
  where user_id = p_user_id
    and session_id = p_session_id
    and content_hash = p_content_hash
    and chunk_index = p_chunk_index;

  if found and v_existing_event.id is not null then
    v_remaining := greatest(v_usage.limit_seconds - v_usage.seconds_used, 0);
    return jsonb_build_object(
      'allowed', true,
      'alreadyConsumed', true,
      'secondsUsed', v_usage.seconds_used,
      'remainingSeconds', v_remaining,
      'limitSeconds', v_usage.limit_seconds,
      'chargedSeconds', v_existing_event.charged_seconds
    );
  end if;

  if v_usage.seconds_used + p_seconds > p_limit_seconds then
    v_remaining := greatest(p_limit_seconds - v_usage.seconds_used, 0);
    return jsonb_build_object(
      'allowed', false,
      'secondsUsed', v_usage.seconds_used,
      'remainingSeconds', v_remaining,
      'limitSeconds', p_limit_seconds,
      'code', 'tts_daily_limit_reached'
    );
  end if;

  insert into public.tts_play_events (
    user_id,
    lecture_id,
    session_id,
    content_hash,
    chunk_index,
    usage_date,
    charged_seconds
  )
  values (
    p_user_id,
    p_lecture_id,
    p_session_id,
    p_content_hash,
    p_chunk_index,
    p_usage_date,
    p_seconds
  )
  on conflict (user_id, session_id, content_hash, chunk_index) do nothing;

  update public.tts_daily_usage
  set seconds_used = seconds_used + p_seconds,
      limit_seconds = p_limit_seconds,
      updated_at = timezone('utc'::text, now())
  where user_id = p_user_id
    and usage_date = p_usage_date
  returning *
  into v_usage;

  v_remaining := greatest(v_usage.limit_seconds - v_usage.seconds_used, 0);
  return jsonb_build_object(
    'allowed', true,
    'alreadyConsumed', false,
    'secondsUsed', v_usage.seconds_used,
    'remainingSeconds', v_remaining,
    'limitSeconds', v_usage.limit_seconds,
    'chargedSeconds', p_seconds
  );
end;
$$;
