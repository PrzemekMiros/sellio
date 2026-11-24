-- Tworzy osobną firmę dla każdego konta oraz uzupełnia konta utworzone przed migracją.
create or replace function public.handle_new_user_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  organization_id uuid;
  organization_name text;
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(new.raw_user_meta_data ->> 'name', '')))
  on conflict (id) do update set full_name = coalesce(excluded.full_name, public.profiles.full_name);

  if not exists (select 1 from public.organization_members where user_id = new.id) then
    organization_name := coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1), 'Moja firma');
    insert into public.organizations (name) values (left(organization_name, 120)) returning id into organization_id;
    insert into public.organization_members (organization_id, user_id, role) values (organization_id, new.id, 'owner');
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_organization on auth.users;
create trigger on_auth_user_created_organization
  after insert on auth.users
  for each row execute procedure public.handle_new_user_organization();

insert into public.profiles (id, full_name)
select id, coalesce(nullif(raw_user_meta_data ->> 'full_name', ''), nullif(raw_user_meta_data ->> 'name', '')) from auth.users
on conflict (id) do nothing;

do $$
declare
  account record;
  organization_id uuid;
begin
  for account in select id, email, raw_user_meta_data from auth.users where not exists (select 1 from public.organization_members m where m.user_id = auth.users.id) loop
    insert into public.organizations (name) values (left(coalesce(nullif(account.raw_user_meta_data ->> 'full_name', ''), split_part(account.email, '@', 1), 'Moja firma'), 120)) returning id into organization_id;
    insert into public.organization_members (organization_id, user_id, role) values (organization_id, account.id, 'owner');
  end loop;
end;
$$;
