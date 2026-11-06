-- Create the minimum organization scope atomically when a confirmed Auth user is created.
alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for select using (id=auth.uid());
create policy profiles_self_update on public.profiles for update using (id=auth.uid()) with check (id=auth.uid());
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare org uuid;
begin
  insert into public.profiles(id,full_name) values(new.id,coalesce(nullif(new.raw_user_meta_data->>'full_name',''),split_part(new.email,'@',1)));
  insert into public.organizations(name) values('Meu consultório') returning id into org;
  insert into public.organization_members(organization_id,user_id,role) values(org,new.id,'owner');
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
