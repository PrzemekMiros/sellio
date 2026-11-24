-- Sellio: podstawowy model danych dla WooCommerce jako głównego magazynu.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('woocommerce', 'allegro')),
  name text not null,
  site_url text,
  external_id text,
  credentials jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, external_id)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  woo_store_id uuid references public.stores(id) on delete set null,
  woo_product_id text not null,
  woo_variation_id text,
  name text not null,
  sku text,
  regular_price numeric(12,2),
  sale_price numeric(12,2),
  stock_quantity integer,
  stock_status text,
  source_modified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (woo_store_id, woo_product_id, woo_variation_id)
);

create table if not exists public.allegro_offers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  allegro_store_id uuid references public.stores(id) on delete set null,
  product_id uuid not null references public.products(id) on delete cascade,
  allegro_offer_id text not null,
  status text,
  price numeric(12,2),
  stock_quantity integer,
  updated_at timestamptz not null default now(),
  unique (allegro_store_id, allegro_offer_id)
);

create table if not exists public.sync_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  direction text not null check (direction in ('woocommerce_to_allegro', 'allegro_to_woocommerce')),
  type text not null check (type in ('stock', 'price', 'offer', 'order')),
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'conflict')),
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists products_organization_id_idx on public.products(organization_id);
create index if not exists products_sku_idx on public.products(organization_id, sku);
create index if not exists sync_events_status_idx on public.sync_events(organization_id, status, created_at);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists stores_set_updated_at on public.stores;
create trigger stores_set_updated_at before update on public.stores for each row execute procedure public.set_updated_at();
drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products for each row execute procedure public.set_updated_at();

create or replace function public.is_organization_member(target_organization_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organization_members where organization_id = target_organization_id and user_id = auth.uid());
$$;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.stores enable row level security;
alter table public.products enable row level security;
alter table public.allegro_offers enable row level security;
alter table public.sync_events enable row level security;

create policy "profiles are visible to their owner" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "members can read their organizations" on public.organizations for select using (public.is_organization_member(id));
create policy "members can read organization members" on public.organization_members for select using (public.is_organization_member(organization_id));
create policy "members can manage stores" on public.stores for all using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));
create policy "members can manage products" on public.products for all using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));
create policy "members can manage offers" on public.allegro_offers for all using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));
create policy "members can read sync history" on public.sync_events for select using (public.is_organization_member(organization_id));
