alter table public.profiles
  add column if not exists trial_lecture_id uuid references public.lectures (id) on delete set null,
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_consumed_at timestamptz;

alter table public.lectures
  add column if not exists access_tier text not null default 'paid';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lectures_access_tier_check'
  ) then
    alter table public.lectures
      add constraint lectures_access_tier_check
      check (access_tier in ('paid', 'trial'));
  end if;
end
$$;

create index if not exists profiles_trial_lecture_id_idx
  on public.profiles (trial_lecture_id)
  where trial_lecture_id is not null;

create or replace function public.claim_trial_lecture(p_user_id uuid, p_lecture_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_has_paid_access boolean;
begin
  select *
  into v_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    return jsonb_build_object(
      'allowed', false,
      'code', 'profile_not_found'
    );
  end if;

  select exists (
    select 1
    from public.billing_subscriptions
    where user_id = p_user_id
      and status in ('active', 'trialing', 'past_due')
  )
  into v_has_paid_access;

  if v_has_paid_access then
    return jsonb_build_object(
      'allowed', true,
      'mode', 'paid'
    );
  end if;

  if v_profile.trial_lecture_id is null then
    update public.profiles
    set
      trial_lecture_id = p_lecture_id,
      trial_started_at = coalesce(trial_started_at, timezone('utc'::text, now())),
      trial_consumed_at = coalesce(trial_consumed_at, timezone('utc'::text, now()))
    where id = p_user_id;

    return jsonb_build_object(
      'allowed', true,
      'mode', 'trial'
    );
  end if;

  if v_profile.trial_lecture_id = p_lecture_id then
    return jsonb_build_object(
      'allowed', true,
      'mode', 'trial'
    );
  end if;

  return jsonb_build_object(
    'allowed', false,
    'code', 'trial_exhausted'
  );
end;
$$;
