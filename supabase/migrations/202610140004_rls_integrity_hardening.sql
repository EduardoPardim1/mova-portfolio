-- Security and integrity hardening. Apply only after 001-003.
create or replace function public.is_org_manager(org_id uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.organization_members where organization_id=org_id and user_id=auth.uid() and role in ('owner','admin'))
$$;

create or replace function public.enforce_assessment_patient_organization() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.patients where id=new.patient_id and organization_id=new.organization_id) then
    raise exception 'assessment patient must belong to the same organization';
  end if;
  if new.professional_id <> auth.uid() and not public.is_org_manager(new.organization_id) then
    raise exception 'professional_id must be the authenticated user';
  end if;
  return new;
end; $$;
create trigger assessments_patient_organization before insert or update of patient_id,organization_id,professional_id on public.assessments for each row execute procedure public.enforce_assessment_patient_organization();

drop policy if exists patients_org on public.patients;
create policy patients_select on public.patients for select using (public.is_member(organization_id));
create policy patients_insert on public.patients for insert with check (public.is_member(organization_id) and responsible_user_id=auth.uid());
create policy patients_update on public.patients for update using (public.is_member(organization_id)) with check (public.is_member(organization_id));

drop policy if exists assessments_org on public.assessments;
create policy assessments_select on public.assessments for select using (public.is_member(organization_id));
create policy assessments_insert on public.assessments for insert with check (public.is_member(organization_id) and professional_id=auth.uid());
create policy assessments_update on public.assessments for update using (public.is_member(organization_id)) with check (public.is_member(organization_id));

create policy metrics_insert on public.gait_metrics for insert with check (exists(select 1 from public.assessments a where a.id=assessment_id and public.is_member(a.organization_id)));
create policy reports_insert on public.reports for insert with check (generated_by=auth.uid() and exists(select 1 from public.assessments a where a.id=assessment_id and public.is_member(a.organization_id)));
alter table public.plans enable row level security;
create policy plans_public_read on public.plans for select using (active=true);
create index organization_members_user_idx on public.organization_members(user_id, organization_id);
create index assessments_organization_created_idx on public.assessments(organization_id, created_at desc);

drop policy if exists "member reads own organization videos" on storage.objects;
create policy "member reads own organization videos" on storage.objects for select using (bucket_id='assessment-videos' and cardinality(storage.foldername(name)) >= 2 and public.is_member((storage.foldername(name))[1]::uuid));
create policy "members upload own organization videos" on storage.objects for insert with check (bucket_id='assessment-videos' and cardinality(storage.foldername(name)) >= 2 and public.is_member((storage.foldername(name))[1]::uuid));
create policy "members delete own organization videos" on storage.objects for delete using (bucket_id='assessment-videos' and cardinality(storage.foldername(name)) >= 2 and public.is_org_manager((storage.foldername(name))[1]::uuid));
