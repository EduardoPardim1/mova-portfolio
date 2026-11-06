-- LOCAL PROPOSAL: requires 001-007. No remote execution authorized.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
 if to_regprocedure('public.save_gait_assessment(uuid,uuid,jsonb)') is null then raise exception '007 required'; end if;
 if exists(select 1 from storage.buckets where id='assessment-reports') then raise exception 'Existing report bucket requires review'; end if;
end $$;
alter table public.assessments add constraint assessments_id_org_reports_unique unique(id,organization_id);
alter table public.reports
 add column organization_id uuid,
 add column patient_id uuid,
 add column report_version text,
 add column snapshot jsonb,
 add column snapshot_hash text,
 add column status text not null default 'legacy' check(status in ('legacy','pending','ready')),
 add column pdf_sha256 text,
 add column pdf_bytes bigint,
 add column completed_at timestamptz,
 add constraint reports_parent_org_fk foreign key(assessment_id,organization_id) references public.assessments(id,organization_id),
 add constraint reports_patient_org_fk foreign key(patient_id,organization_id) references public.patients(id,organization_id),
 add constraint reports_generator_member_fk foreign key(organization_id,generated_by) references public.organization_members(organization_id,user_id),
 add constraint reports_snapshot_unique unique(assessment_id,generated_by,report_version,snapshot_hash),
 add constraint reports_state_check check(status='legacy' or
   (organization_id is not null and patient_id is not null and report_version='mova-report-1'
    and snapshot is not null and jsonb_typeof(snapshot)='object' and snapshot_hash is not null and snapshot_hash ~ '^[0-9a-f]{64}$'
    and ((status='pending' and pdf_sha256 is null and pdf_bytes is null and completed_at is null)
      or (status='ready' and pdf_sha256 is not null and pdf_sha256 ~ '^[0-9a-f]{64}$'
          and pdf_bytes is not null and pdf_bytes between 1 and 5242880 and completed_at is not null))));
create index reports_org_date_idx on public.reports(organization_id,generated_at desc,id);

-- Single MVCC statement: snapshot comes from authorized database rows, not client JSON.
create function public.report_source_snapshot(assessment uuid,org uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('schema_version','mova-report-1',
  'organization',jsonb_build_object('id',o.id,'name',o.name),
  'patient',jsonb_build_object('id',p.id,'name',p.full_name,'birth_date',p.birth_date,'sex',p.sex),
  'assessment',jsonb_build_object('id',a.id,'professional_id',a.professional_id,'protocol',a.protocol,'created_at',a.created_at,'algorithm_version',a.algorithm_version,'notes',a.notes,'status',a.status),
  'generator',jsonb_build_object('id',u.id,'name',u.full_name),
  'metrics',jsonb_build_object('duration_seconds',m.duration_seconds,'estimated_steps',m.estimated_steps,'cadence_spm',m.cadence_spm,'speed_mps',m.speed_mps,'limitations',m.limitations,
   'quality',jsonb_build_object('level',m.quality->'level','mean_visibility',m.quality->'mean_visibility','usable_frames',m.quality->'usable_frames','total_frames',m.quality->'total_frames','detection_rate',m.quality->'detection_rate','step_regularity',m.quality->'step_regularity','temporal_symmetry',m.quality->'temporal_symmetry')))
 from public.assessments a join public.patients p on (p.id,p.organization_id)=(a.patient_id,a.organization_id)
 join public.organizations o on o.id=a.organization_id join public.gait_metrics m on m.assessment_id=a.id
 join public.profiles u on u.id=auth.uid()
 where a.id=assessment and a.organization_id=org and a.status in ('reviewed','final') and public.is_member(org)
$$;
revoke all on function public.report_source_snapshot(uuid,uuid) from public,anon;
grant execute on function public.report_source_snapshot(uuid,uuid) to authenticated;

create function public.guard_report_snapshot() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or new.generated_by<>auth.uid() or not public.is_member(new.organization_id)
 then raise exception using errcode='42501',message='Report scope denied'; end if;
 if (select count(*) from public.organization_members where user_id=auth.uid())<>1
 then raise exception using errcode='PT409',message='Ambiguous organization'; end if;
 if tg_op='INSERT' then
  if new.snapshot is not null or new.snapshot_hash is not null or new.pdf_sha256 is not null or new.pdf_bytes is not null or new.completed_at is not null
  then raise exception using errcode='42501',message='Protected report fields'; end if;
  new.snapshot:=public.report_source_snapshot(new.assessment_id,new.organization_id);
  if new.snapshot is null then raise exception using errcode='PT404',message='Reviewed assessment with metrics required'; end if;
  new.patient_id:=(new.snapshot->'patient'->>'id')::uuid;
  new.snapshot_hash:=encode(sha256(convert_to(new.snapshot::text,'UTF8')),'hex');
  new.report_version:='mova-report-1';new.status:='pending';new.generated_at:=statement_timestamp();
  new.storage_path:=new.organization_id::text||'/'||new.id::text||'.pdf';
 else
  if (to_jsonb(new)-array['status','pdf_sha256','pdf_bytes','completed_at']) is distinct from
     (to_jsonb(old)-array['status','pdf_sha256','pdf_bytes','completed_at'])
  then raise exception using errcode='42501',message='Immutable report snapshot'; end if;
  if old.status<>'pending' or new.status<>'ready' then raise exception using errcode='42501',message='Invalid report transition'; end if;
  if not exists(select 1 from storage.objects where bucket_id='assessment-reports' and name=old.storage_path)
  then raise exception using errcode='23514',message='Report object missing'; end if;
  new.completed_at:=statement_timestamp();
 end if;
 return new;
end $$;
revoke all on function public.guard_report_snapshot() from public,anon;
create trigger reports_snapshot_guard before insert or update on public.reports for each row execute function public.guard_report_snapshot();
create policy reports_complete on public.reports for update to authenticated
 using(generated_by=auth.uid() and public.is_member(organization_id))
 with check(generated_by=auth.uid() and public.is_member(organization_id));
grant update(status,pdf_sha256,pdf_bytes,completed_at) on public.reports to authenticated;

create function public.prepare_assessment_report(p_assessment uuid,p_org uuid) returns jsonb
language plpgsql volatile security invoker set search_path='' set lock_timeout='5s' as $$
declare saved public.reports%rowtype; candidate_id uuid:=gen_random_uuid(); source jsonb; digest text;
begin
 if auth.uid() is null then raise exception using errcode='PT401',message='Authentication required'; end if;
 if (select count(*) from public.organization_members where user_id=auth.uid())<>1 or not public.is_member(p_org)
 then raise exception using errcode='42501',message='Report scope denied'; end if;
 insert into public.reports(id,assessment_id,generated_by,organization_id,storage_path)
 values(candidate_id,p_assessment,auth.uid(),p_org,'derived-by-trigger')
 on conflict on constraint reports_snapshot_unique do nothing returning * into saved;
 if saved.id is null then
  source:=public.report_source_snapshot(p_assessment,p_org);
  digest:=encode(sha256(convert_to(source::text,'UTF8')),'hex');
  select * into saved from public.reports where assessment_id=p_assessment and generated_by=auth.uid()
   and report_version='mova-report-1' and snapshot_hash=digest and organization_id=p_org;
  if saved.id is null then raise exception using errcode='40001',message='Source changed; retry'; end if;
 end if;
 return to_jsonb(saved);
end $$;
revoke all on function public.prepare_assessment_report(uuid,uuid) from public,anon;
grant execute on function public.prepare_assessment_report(uuid,uuid) to authenticated;

create function public.complete_assessment_report(p_id uuid,p_org uuid,p_hash text,p_bytes bigint) returns jsonb
language plpgsql volatile security invoker set search_path='' set lock_timeout='5s' as $$
declare saved public.reports%rowtype;
begin
 if auth.uid() is null or not public.is_member(p_org) or (select count(*) from public.organization_members where user_id=auth.uid())<>1
 then raise exception using errcode='42501',message='Report scope denied'; end if;
 select * into saved from public.reports where id=p_id and organization_id=p_org and generated_by=auth.uid() for update;
 if not found then raise exception using errcode='PT404',message='Report unavailable'; end if;
 if saved.status='ready' then
  if saved.pdf_sha256 is distinct from p_hash or saved.pdf_bytes is distinct from p_bytes
  then raise exception using errcode='PT409',message='Report content mismatch'; end if;
 else
  update public.reports set status='ready',pdf_sha256=p_hash,pdf_bytes=p_bytes where id=p_id returning * into saved;
 end if;
 return to_jsonb(saved);
end $$;
revoke all on function public.complete_assessment_report(uuid,uuid,text,bigint) from public,anon;
grant execute on function public.complete_assessment_report(uuid,uuid,text,bigint) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('assessment-reports','assessment-reports',false,5242880,array['application/pdf']);
create function public.can_access_report_object(object_name text,writing boolean default false) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.reports r where r.storage_path=object_name
  and r.status in ('pending','ready') and public.is_member(r.organization_id)
  and object_name=r.organization_id::text||'/'||r.id::text||'.pdf'
  and (not writing or (r.status='pending' and r.generated_by=auth.uid()))
  and (r.status='ready' or r.generated_by=auth.uid()))
$$;
revoke all on function public.can_access_report_object(text,boolean) from public,anon;
grant execute on function public.can_access_report_object(text,boolean) to authenticated;
create policy reports_private_read on storage.objects for select to authenticated
 using(bucket_id='assessment-reports' and public.can_access_report_object(name));
create policy reports_private_upload on storage.objects for insert to authenticated
 with check(bucket_id='assessment-reports' and public.can_access_report_object(name,true));
-- No object UPDATE, DELETE or upsert policy. Completed files are immutable.
commit;
