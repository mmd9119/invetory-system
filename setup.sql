
-- =========================================
-- PRIVATE INVENTORY SYSTEM
-- Authorized users:
-- mmdowhe@gmail.com
-- hossein5khezri@gmail.com
-- =========================================

create extension if not exists pgcrypto;

-- 1. PRODUCTS
create table if not exists public.inventory_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  tag text default '',
  description text default '',
  purchase_type text not null
    check (purchase_type in ('aed', 'irr')),
  buy_price numeric(14,2) not null default 0,
  freight numeric(14,2) not null default 0,
  profit_type text not null default 'fixed'
    check (profit_type in ('fixed', 'percent')),
  profit_value numeric(14,2) not null default 0,
  quantity integer not null default 0
    check (quantity >= 0),
  image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. SETTINGS
create table if not exists public.inventory_settings (
  id integer primary key check (id = 1),
  dirham_rate numeric(14,2) not null default 0
);

insert into public.inventory_settings (id, dirham_rate)
values (1, 0)
on conflict (id) do nothing;

-- 3. SALE EVENTS
create table if not exists public.inventory_sale_events (
  event_id uuid primary key,
  product_id uuid not null
    references public.inventory_products(id) on delete cascade,
  user_email text not null,
  created_at timestamptz not null default now()
);

-- 4. AUTHORIZATION FUNCTION
create or replace function public.inventory_user_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    lower(auth.jwt() ->> 'email') in (
      'mmdowhe@gmail.com',
      'hossein5khezri@gmail.com'
    ),
    false
  );
$$;

revoke all on function public.inventory_user_allowed() from public;
grant execute on function public.inventory_user_allowed() to authenticated;

-- 5. ENABLE RLS
alter table public.inventory_products enable row level security;
alter table public.inventory_settings enable row level security;
alter table public.inventory_sale_events enable row level security;

-- 6. PRODUCTS POLICIES
drop policy if exists "inventory_products_select" on public.inventory_products;
create policy "inventory_products_select"
on public.inventory_products
for select to authenticated
using (public.inventory_user_allowed());

drop policy if exists "inventory_products_insert" on public.inventory_products;
create policy "inventory_products_insert"
on public.inventory_products
for insert to authenticated
with check (public.inventory_user_allowed());

drop policy if exists "inventory_products_update" on public.inventory_products;
create policy "inventory_products_update"
on public.inventory_products
for update to authenticated
using (public.inventory_user_allowed())
with check (public.inventory_user_allowed());

drop policy if exists "inventory_products_delete" on public.inventory_products;
create policy "inventory_products_delete"
on public.inventory_products
for delete to authenticated
using (public.inventory_user_allowed());

-- 7. PREVENT ACCIDENTAL STOCK OVERWRITE
create or replace function public.protect_inventory_quantity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.quantity is distinct from old.quantity
     and current_user <> 'postgres'
     and current_user <> 'supabase_admin' then
    raise exception 'Change stock using the inventory stock functions';
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_quantity_protection
on public.inventory_products;

create trigger inventory_quantity_protection
before update on public.inventory_products
for each row
execute function public.protect_inventory_quantity();

-- 8. SETTINGS POLICIES
drop policy if exists "inventory_settings_select" on public.inventory_settings;
create policy "inventory_settings_select"
on public.inventory_settings
for select to authenticated
using (public.inventory_user_allowed());

drop policy if exists "inventory_settings_insert" on public.inventory_settings;
create policy "inventory_settings_insert"
on public.inventory_settings
for insert to authenticated
with check (public.inventory_user_allowed());

drop policy if exists "inventory_settings_update" on public.inventory_settings;
create policy "inventory_settings_update"
on public.inventory_settings
for update to authenticated
using (public.inventory_user_allowed())
with check (public.inventory_user_allowed());

-- 9. SALE EVENTS READ POLICY
drop policy if exists "inventory_sale_events_select"
on public.inventory_sale_events;

create policy "inventory_sale_events_select"
on public.inventory_sale_events
for select to authenticated
using (public.inventory_user_allowed());

-- 10. ATOMIC SALE FUNCTION
create or replace function public.apply_inventory_sale(
  p_event_id uuid,
  p_product_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_inserted integer;
  v_existing_product uuid;
  v_existing_email text;
begin
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if v_email not in (
    'mmdowhe@gmail.com',
    'hossein5khezri@gmail.com'
  ) then
    raise exception 'Not authorized';
  end if;

  insert into public.inventory_sale_events (
    event_id,
    product_id,
    user_email
  )
  values (
    p_event_id,
    p_product_id,
    v_email
  )
  on conflict (event_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select product_id, user_email
    into v_existing_product, v_existing_email
    from public.inventory_sale_events
    where event_id = p_event_id;

    if v_existing_product = p_product_id
       and v_existing_email = v_email then
      return true;
    end if;

    raise exception 'Sale event ID conflict';
  end if;

  update public.inventory_products
  set quantity = quantity - 1,
      updated_at = now()
  where id = p_product_id
    and quantity > 0;

  if not found then
    raise exception 'Product not found or stock is empty';
  end if;

  return true;
end;
$$;

revoke all on function public.apply_inventory_sale(uuid, uuid) from public;
grant execute on function public.apply_inventory_sale(uuid, uuid) to authenticated;

-- 11. SET STOCK FUNCTION
create or replace function public.set_inventory_quantity(
  p_product_id uuid,
  p_quantity integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if v_email not in (
    'mmdowhe@gmail.com',
    'hossein5khezri@gmail.com'
  ) then
    raise exception 'Not authorized';
  end if;

  if p_quantity < 0 then
    raise exception 'Quantity cannot be negative';
  end if;

  update public.inventory_products
  set quantity = p_quantity,
      updated_at = now()
  where id = p_product_id;

  if not found then
    raise exception 'Product not found';
  end if;

  return true;
end;
$$;

revoke all on function public.set_inventory_quantity(uuid, integer) from public;
grant execute on function public.set_inventory_quantity(uuid, integer) to authenticated;

-- 12. TABLE PERMISSIONS
grant select, insert, update, delete
on public.inventory_products to authenticated;

grant select, insert, update
on public.inventory_settings to authenticated;

grant select
on public.inventory_sale_events to authenticated;

-- 13. PRIVATE STORAGE BUCKET
insert into storage.buckets (id, name, public)
values ('inventory-photos', 'inventory-photos', false)
on conflict (id) do update set public = false;

drop policy if exists "inventory_photos_select" on storage.objects;
create policy "inventory_photos_select"
on storage.objects
for select to authenticated
using (
  bucket_id = 'inventory-photos'
  and public.inventory_user_allowed()
);

drop policy if exists "inventory_photos_insert" on storage.objects;
create policy "inventory_photos_insert"
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'inventory-photos'
  and public.inventory_user_allowed()
);

drop policy if exists "inventory_photos_update" on storage.objects;
create policy "inventory_photos_update"
on storage.objects
for update to authenticated
using (
  bucket_id = 'inventory-photos'
  and public.inventory_user_allowed()
)
with check (
  bucket_id = 'inventory-photos'
  and public.inventory_user_allowed()
);

drop policy if exists "inventory_photos_delete" on storage.objects;
create policy "inventory_photos_delete"
on storage.objects
for delete to authenticated
using (
  bucket_id = 'inventory-photos'
  and public.inventory_user_allowed()
);

-- 14. REALTIME
do $$
begin
  alter publication supabase_realtime
  add table public.inventory_products;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime
  add table public.inventory_settings;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime
  add table public.inventory_sale_events;
exception
  when duplicate_object then null;
end $$;
