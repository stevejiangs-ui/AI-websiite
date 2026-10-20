-- 个人APP 2.2 新增两张表：身体健康打卡 health_logs、利好消息 signals
-- 在 WorkBuddy 里发布前，把这个文件发给 WorkBuddy，说「按这个建表，权限规则和 entries 表一样」即可。
-- owner_id 的类型、默认值、RLS 策略请与现有 entries 表保持一致。

create table if not exists public.health_logs (
  id            bigserial primary key,
  owner_id      uuid not null default auth.uid(),
  log_date      date not null,
  sleep_hours   numeric,
  weight_kg     numeric,
  exercise_min  integer,
  steps         integer,
  mood          smallint,      -- 1-5
  energy        smallint,      -- 1-5
  water_cups    smallint,
  note          text default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (owner_id, log_date)
);

create table if not exists public.signals (
  id          bigserial primary key,
  owner_id    uuid not null default auth.uid(),
  title       text not null default '',
  content     text default '',
  url         text default '',
  source      text default '',
  area        text default 'life',   -- money / work / family / health / life
  status      text default 'new',    -- new / acted / archived
  ai_take     text,
  ai_score    smallint,              -- -2 不利 … +2 很有利
  ai_at       timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.health_logs enable row level security;
alter table public.signals     enable row level security;

-- 只能读写自己的数据（与 entries 表规则一致；若 entries 还允许 account_links 关联账号访问，这里照搬）
create policy health_logs_owner on public.health_logs
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy signals_owner on public.signals
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
