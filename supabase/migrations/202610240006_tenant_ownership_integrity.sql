-- LOCAL PROPOSAL ONLY. Do not apply remotely without approval and legacy preflight.
-- Atomic: any incompatible legacy row aborts; no data repair/deletion is attempted.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.patients add constraint patients_id_org_unique unique (id, organization_id);
alter table public.assessments add constraint assessments_patient_org_fk
  foreign key (patient_id, organization_id) references public.patients(id, organization_id) on update restrict on delete restrict not valid;
alter table public.patients add constraint patients_responsible_membership_fk
  foreign key (organization_id, responsible_user_id) references public.organization_members(organization_id, user_id) on update restrict on delete restrict not valid;
alter table public.assessments add constraint assessments_professional_membership_fk
  foreign key (organization_id, professional_id) references public.organization_members(organization_id, user_id) on update restrict on delete restrict not valid;
alter table public.assessments validate constraint assessments_patient_org_fk;
alter table public.patients validate constraint patients_responsible_membership_fk;
alter table public.assessments validate constraint assessments_professional_membership_fk;

-- Organization membership checks alone allow legitimate A+B members to move parents.
-- Preserve record identity, tenant and provenance, even for organization managers.
create function public.reject_tenant_rebinding() returns trigger
language plpgsql set search_path = '' as $$
declare field_name text;
begin
  foreach field_name in array tg_argv loop
    if (to_jsonb(new)->field_name) is distinct from (to_jsonb(old)->field_name) then
      raise exception using errcode = '42501', message = 'Protected record association cannot be changed';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.reject_tenant_rebinding() from public;
create trigger patients_immutable_scope before update on public.patients for each row
  execute function public.reject_tenant_rebinding('id','organization_id','responsible_user_id');
create trigger assessments_immutable_scope before update on public.assessments for each row
  execute function public.reject_tenant_rebinding('id','organization_id','patient_id','professional_id');
create trigger metrics_immutable_parent before update on public.gait_metrics for each row
  execute function public.reject_tenant_rebinding('id','assessment_id');
create trigger reports_immutable_parent before update on public.reports for each row
  execute function public.reject_tenant_rebinding('id','assessment_id','generated_by','storage_path');
create trigger videos_immutable_parent before update on public.assessment_videos for each row
  execute function public.reject_tenant_rebinding('id','assessment_id','storage_path');

-- No UUID casts on untrusted object names. Canonical org/assessment/file path only.
create function public.matches_assessment_video_path(object_name text, org_id uuid, assessment_id uuid)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(array_length(string_to_array(object_name, '/'), 1) = 3
    and split_part(object_name, '/', 1) = org_id::text
    and split_part(object_name, '/', 2) = assessment_id::text
    and split_part(object_name, '/', 3) ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$', false)
$$;
revoke all on function public.matches_assessment_video_path(text,uuid,uuid) from public;
grant execute on function public.matches_assessment_video_path(text,uuid,uuid) to authenticated;

-- Deliberately abort on legacy mismatches, including objects with no parent.
do $$
begin
  if exists(select 1 from public.assessment_videos v join public.assessments a on a.id=v.assessment_id
    where not public.matches_assessment_video_path(v.storage_path,a.organization_id,a.id))
    or exists(select 1 from storage.objects o where o.bucket_id='assessment-videos'
      and not exists(select 1 from public.assessments a where public.matches_assessment_video_path(o.name,a.organization_id,a.id)))
    or exists(select 1 from storage.buckets where id='assessment-videos' and public=true) then
    raise exception 'Legacy video scope or bucket privacy requires manual review';
  end if;
end;
$$;

create function public.enforce_video_parent_path() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists(select 1 from public.assessments a where a.id=new.assessment_id
      and public.matches_assessment_video_path(new.storage_path,a.organization_id,a.id)) then
    raise exception using errcode='23514', message='Invalid video association';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_video_parent_path() from public;
create trigger videos_parent_path before insert or update on public.assessment_videos
  for each row execute function public.enforce_video_parent_path();

-- Replace historical ALL policy: default grants must not imply metadata deletion.
drop policy videos_org on public.assessment_videos;
create policy videos_select on public.assessment_videos for select to authenticated
  using (exists(select 1 from public.assessments a where a.id=assessment_id and public.is_member(a.organization_id)));
create policy videos_insert on public.assessment_videos for insert to authenticated
  with check (exists(select 1 from public.assessments a where a.id=assessment_id and public.is_member(a.organization_id)));
create policy videos_update on public.assessment_videos for update to authenticated
  using (exists(select 1 from public.assessments a where a.id=assessment_id and public.is_member(a.organization_id)))
  with check (exists(select 1 from public.assessments a where a.id=assessment_id and public.is_member(a.organization_id)));

-- Invoker: assessment RLS still applies; membership is checked explicitly as well.
create function public.can_access_assessment_video(object_name text, manager_only boolean default false)
returns boolean language sql stable set search_path = '' as $$
  select exists(select 1 from public.assessments a
    where public.matches_assessment_video_path(object_name,a.organization_id,a.id)
      and public.is_member(a.organization_id)
      and (not manager_only or public.is_org_manager(a.organization_id)))
$$;
revoke all on function public.can_access_assessment_video(text,boolean) from public;
grant execute on function public.can_access_assessment_video(text,boolean) to authenticated;

drop policy "member reads own organization videos" on storage.objects;
drop policy "members upload own organization videos" on storage.objects;
drop policy "members delete own organization videos" on storage.objects;
create policy "member reads own organization videos" on storage.objects for select to authenticated
  using (bucket_id='assessment-videos' and public.can_access_assessment_video(name));
create policy "members upload own organization videos" on storage.objects for insert to authenticated
  with check (bucket_id='assessment-videos' and public.can_access_assessment_video(name));
create policy "members delete own organization videos" on storage.objects for delete to authenticated
  using (bucket_id='assessment-videos' and public.can_access_assessment_video(name,true));
-- No UPDATE/UPSERT policy; no public bucket; no grants bypassing RLS.
create index patients_responsible_membership_idx on public.patients(organization_id,responsible_user_id);
create index assessments_professional_membership_idx on public.assessments(organization_id,professional_id);
commit;
