create table if not exists public.api_rate_limits (
  rate_key text not null,
  route text not null,
  window_seconds integer not null check (window_seconds > 0),
  bucket_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  primary key (rate_key, route, window_seconds, bucket_start)
);

create index if not exists api_rate_limits_updated_at_idx
  on public.api_rate_limits (updated_at asc);

alter table public.api_rate_limits enable row level security;

create or replace function public.consume_rate_limit(
  p_rate_key text,
  p_route text,
  p_window_seconds integer,
  p_max_requests integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer,
  limit_count integer,
  window_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc'::text, now());
  v_window_seconds integer := greatest(p_window_seconds, 1);
  v_max_requests integer := greatest(p_max_requests, 1);
  v_bucket_epoch bigint;
  v_bucket_start timestamptz;
  v_request_count integer;
  v_retry_after integer;
begin
  v_bucket_epoch :=
    floor(extract(epoch from v_now) / v_window_seconds)::bigint * v_window_seconds;
  v_bucket_start := to_timestamp(v_bucket_epoch);

  insert into public.api_rate_limits (
    rate_key,
    route,
    window_seconds,
    bucket_start,
    request_count,
    updated_at
  )
  values (
    p_rate_key,
    p_route,
    v_window_seconds,
    v_bucket_start,
    1,
    v_now
  )
  on conflict (rate_key, route, window_seconds, bucket_start)
  do update
    set request_count = public.api_rate_limits.request_count + 1,
        updated_at = v_now
  returning public.api_rate_limits.request_count
  into v_request_count;

  v_retry_after := greatest(
    ceil(
      extract(
        epoch from ((v_bucket_start + make_interval(secs => v_window_seconds)) - v_now)
      )
    )::integer,
    1
  );

  return query
  select
    v_request_count <= v_max_requests,
    greatest(v_max_requests - v_request_count, 0),
    v_retry_after,
    v_max_requests,
    v_window_seconds;
end;
$$;
