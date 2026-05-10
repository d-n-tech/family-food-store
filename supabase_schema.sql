-- Run this in Supabase SQL Editor

create table if not exists freezers (
  id text primary key, name text not null, created_at timestamptz default now()
);
create table if not exists bags (
  id text primary key, name text not null,
  freezer_id text references freezers(id) on delete cascade,
  created_at timestamptz default now()
);
create table if not exists items (
  id text primary key, name text not null,
  freezer_id text references freezers(id) on delete cascade,
  bag_id text references bags(id) on delete set null,
  pieces integer not null default 1,
  qty text, unit text default 'g',
  date_added date not null, shelf_days integer not null default 180,
  category text, min_pieces integer, barcode text,
  created_at timestamptz default now()
);
create table if not exists consumption_log (
  id text primary key, item_name text not null,
  freezer_id text, bag_id text, amount integer default 1,
  logged_at timestamptz default now()
);
create table if not exists shops (
  id text primary key, name text not null, created_at timestamptz default now()
);
create table if not exists shopping_list (
  id text primary key,
  shop_id text references shops(id) on delete cascade,
  name text not null, qty text, unit text,
  done boolean default false, created_at timestamptz default now()
);

-- Enable RLS
alter table freezers enable row level security;
alter table bags enable row level security;
alter table items enable row level security;
alter table consumption_log enable row level security;
alter table shops enable row level security;
alter table shopping_list enable row level security;

-- Policies (drop first to avoid conflicts)
drop policy if exists "public all" on freezers;
drop policy if exists "public all" on bags;
drop policy if exists "public all" on items;
drop policy if exists "public all" on consumption_log;
drop policy if exists "public all" on shops;
drop policy if exists "public all" on shopping_list;

create policy "public all" on freezers for all using (true) with check (true);
create policy "public all" on bags for all using (true) with check (true);
create policy "public all" on items for all using (true) with check (true);
create policy "public all" on consumption_log for all using (true) with check (true);
create policy "public all" on shops for all using (true) with check (true);
create policy "public all" on shopping_list for all using (true) with check (true);

-- Default freezers
insert into freezers (id, name) values
  ('f1','Diepvries thuis'),
  ('f2','Diepvries loods links'),
  ('f3','Diepvries loods rechts')
on conflict (id) do nothing;
