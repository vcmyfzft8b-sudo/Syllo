update public.profiles
set trial_consumed_at = coalesce(trial_consumed_at, trial_started_at, timezone('utc'::text, now()))
where trial_consumed_at is null
  and (
    trial_started_at is not null
    or trial_lecture_id is not null
  );

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

  if v_profile.trial_lecture_id = p_lecture_id then
    update public.profiles
    set
      trial_started_at = coalesce(trial_started_at, timezone('utc'::text, now())),
      trial_consumed_at = coalesce(trial_consumed_at, timezone('utc'::text, now()))
    where id = p_user_id;

    return jsonb_build_object(
      'allowed', true,
      'mode', 'trial'
    );
  end if;

  if v_profile.trial_consumed_at is not null then
    return jsonb_build_object(
      'allowed', false,
      'code', 'trial_exhausted'
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

  return jsonb_build_object(
    'allowed', false,
    'code', 'trial_exhausted'
  );
end;
$$;
