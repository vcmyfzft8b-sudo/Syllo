alter table public.profiles
  add column if not exists updated_at timestamptz not null default timezone('utc'::text, now()),
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists age_range text,
  add column if not exists education_level text,
  add column if not exists current_average_grade text,
  add column if not exists target_grade text,
  add column if not exists study_goal text,
  add column if not exists stripe_customer_id text;

create unique index if not exists profiles_stripe_customer_id_unique
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_age_range_check'
  ) then
    alter table public.profiles
      add constraint profiles_age_range_check
      check (
        age_range is null
        or age_range in ('under_16', '16_18', '19_22', '23_29', '30_plus')
      );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_education_level_check'
  ) then
    alter table public.profiles
      add constraint profiles_education_level_check
      check (
        education_level is null
        or education_level in ('high_school', 'university', 'masters', 'self_study', 'other')
      );
  end if;
end
$$;

create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text not null unique,
  stripe_price_id text,
  plan text not null check (plan in ('weekly', 'monthly', 'yearly')),
  status text not null check (
    status in (
      'incomplete',
      'incomplete_expired',
      'trialing',
      'active',
      'past_due',
      'canceled',
      'unpaid',
      'paused'
    )
  ),
  currency text not null default 'eur',
  unit_amount integer,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists billing_subscriptions_user_id_idx
  on public.billing_subscriptions (user_id, updated_at desc);

create unique index if not exists billing_subscriptions_customer_subscription_unique
  on public.billing_subscriptions (stripe_customer_id, stripe_subscription_id);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists billing_subscriptions_set_updated_at on public.billing_subscriptions;
create trigger billing_subscriptions_set_updated_at
before update on public.billing_subscriptions
for each row execute procedure public.set_updated_at();

alter table public.billing_subscriptions enable row level security;

create policy "billing_subscriptions_select_own"
  on public.billing_subscriptions
  for select
  using (auth.uid() = user_id);
