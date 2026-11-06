-- LOCAL PROPOSAL. Requires 001-006; no remote application authorized.
-- Legacy rows keep NULL request metadata and are not repaired or deleted.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
  if (select count(*) from pg_catalog.pg_constraint
      where conrelid='public.assessments'::regclass and convalidated
      and conname in ('assessments_patient_org_fk','assessments_professional_membership_fk')) <> 2
  then raise exception 'Migration 006 must be reviewed and applied before 007'; end if;
end $$;

alter table public.assessments add column save_request_id uuid;
alter table public.assessments add column save_request_hash bytea;
alter table public.assessments add constraint assessments_save_metadata_check check (
  (save_request_id is null and save_request_hash is null) or
  (save_request_id is not null and save_request_hash is not null and octet_length(save_request_hash)=32));
alter table public.assessments add constraint assessments_save_request_unique
  unique(organization_id,professional_id,save_request_id);

create function public.reject_assessment_request_rebinding() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if (new.save_request_id,new.save_request_hash) is distinct from (old.save_request_id,old.save_request_hash)
  then raise exception using errcode='42501',message='Protected save identity'; end if;
  return new;
end $$;
revoke all on function public.reject_assessment_request_rebinding() from public,anon;
create trigger assessments_immutable_save_request before update on public.assessments
for each row execute function public.reject_assessment_request_rebinding();

-- Deferred: the RPC inserts parent first, then metric, in the same transaction.
-- Also protects direct creation/finalization of reviewed records without a key.
-- Historical incomplete records are not retroactively repaired or deleted.
create function public.require_saved_assessment_metrics() returns trigger
language plpgsql security invoker set search_path='' as $$
declare parent_id uuid;
begin
  if tg_table_name='assessments' then
    parent_id:=new.id;
    -- Permit ordinary edits of legacy rows, but not a new completion transition.
    if tg_op='UPDATE' and new.save_request_id is null and old.status is not distinct from new.status
    then return null; end if;
  else parent_id:=old.assessment_id;
  end if;
  if exists(select 1 from public.assessments a where a.id=parent_id
      and (a.save_request_id is not null or a.status in ('reviewed','final')))
    and not exists(select 1 from public.gait_metrics m where m.assessment_id=parent_id)
  then raise exception using errcode='23514',message='Saved assessment requires metrics'; end if;
  return null;
end $$;
revoke all on function public.require_saved_assessment_metrics() from public,anon;
create constraint trigger assessments_metrics_required after insert or update on public.assessments
deferrable initially deferred for each row execute function public.require_saved_assessment_metrics();
create constraint trigger metrics_saved_parent_required after delete or update on public.gait_metrics
deferrable initially deferred for each row execute function public.require_saved_assessment_metrics();

create function public.save_gait_assessment(p_request_id uuid,p_organization_id uuid,p_payload jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' set lock_timeout='5s' as $$
declare
  actor uuid:=auth.uid(); payload_hash bytea; saved public.assessments%rowtype;
  created boolean; field text; value jsonb; n numeric; quality jsonb;
  fields text[]:=array['patient_id','protocol','capture_conditions','manual_duration_seconds','algorithm_version','notes',
    'duration_seconds','estimated_steps','cadence_spm','speed_mps','quality','limitations'];
begin
  if actor is null then raise exception using errcode='PT401',message='Authentication required'; end if;
  if p_request_id is null or p_organization_id is null then raise exception using errcode='PT400',message='Invalid save request'; end if;
  if not exists(select 1 from public.organization_members m where m.user_id=actor and m.organization_id=p_organization_id)
  then raise exception using errcode='PT403',message='Organization unavailable'; end if;
  if (select count(*) from public.organization_members m where m.user_id=actor)<>1
  then raise exception using errcode='PT409',message='Ambiguous organization'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>65536
    or not (p_payload ?& fields) or exists(select 1 from jsonb_object_keys(p_payload) k where not (k=any(fields)))
  then raise exception using errcode='PT400',message='Invalid save payload'; end if;
  if jsonb_typeof(p_payload->'patient_id') is distinct from 'string'
    or jsonb_typeof(p_payload->'protocol') is distinct from 'string'
    or p_payload->>'protocol' not in ('gait_video','walk_10m')
    or jsonb_typeof(p_payload->'capture_conditions') is distinct from 'object'
    or jsonb_typeof(p_payload->'algorithm_version') is distinct from 'string'
    or char_length(p_payload->>'algorithm_version') not between 1 and 80
    or jsonb_typeof(p_payload->'notes') not in ('null','string') or char_length(p_payload->>'notes')>2000
    or jsonb_typeof(p_payload->'limitations') is distinct from 'string' or char_length(p_payload->>'limitations')>10020
  then raise exception using errcode='PT400',message='Invalid assessment fields'; end if;
  foreach field in array array['duration_seconds','estimated_steps','cadence_spm','speed_mps','manual_duration_seconds'] loop
    value:=p_payload->field;
    if jsonb_typeof(value)='null' and field<>'duration_seconds' then continue; end if;
    if jsonb_typeof(value) is distinct from 'number' then raise exception using errcode='PT400',message='Invalid metric type'; end if;
    n:=(value::text)::numeric;
    if n<0 or (field in ('duration_seconds','manual_duration_seconds') and n<=0)
      or (field='manual_duration_seconds' and n>7200)
      or (field='estimated_steps' and (n<>trunc(n) or n>2147483647))
    then raise exception using errcode='PT400',message='Invalid metric range'; end if;
  end loop;
  quality:=p_payload->'quality';
  fields:=array['level','mean_visibility','usable_frames','total_frames','detection_rate','step_regularity','temporal_symmetry'];
  if jsonb_typeof(quality) is distinct from 'object' or not (quality ?& fields)
    or exists(select 1 from jsonb_object_keys(quality) k where not (k=any(fields)))
    or jsonb_typeof(quality->'level') is distinct from 'string' or quality->>'level' not in ('adequada','limitada','insuficiente')
  then raise exception using errcode='PT400',message='Invalid quality'; end if;
  foreach field in array array['mean_visibility','usable_frames','total_frames','detection_rate','step_regularity','temporal_symmetry'] loop
    value:=quality->field;
    if jsonb_typeof(value)='null' and field not in ('usable_frames','total_frames') then continue; end if;
    if jsonb_typeof(value) is distinct from 'number' then raise exception using errcode='PT400',message='Invalid quality type'; end if;
    n:=(value::text)::numeric;
    if n<0 or (field in ('usable_frames','total_frames') and n<>trunc(n))
      or (field in ('mean_visibility','detection_rate') and n>1)
      or (field in ('step_regularity','temporal_symmetry') and n>100)
    then raise exception using errcode='PT400',message='Invalid quality range'; end if;
  end loop;
  payload_hash:=pg_catalog.sha256(pg_catalog.convert_to(p_payload::text,'UTF8'));
  select * into saved from public.assessments a where a.organization_id=p_organization_id
    and a.professional_id=actor and a.save_request_id=p_request_id;
  if not found then
    -- SHARE prevents archive/rebinding between validation and commit. RLS remains active.
    perform 1 from public.patients p where p.id=(p_payload->>'patient_id')::uuid
      and p.organization_id=p_organization_id and p.archived_at is null for share;
    if not found then raise exception using errcode='PT404',message='Patient unavailable'; end if;
    insert into public.assessments(organization_id,patient_id,professional_id,protocol,capture_conditions,
      manual_duration_seconds,algorithm_version,notes,status,save_request_id,save_request_hash)
    values(p_organization_id,(p_payload->>'patient_id')::uuid,actor,p_payload->>'protocol',p_payload->'capture_conditions',
      (p_payload->>'manual_duration_seconds')::numeric,p_payload->>'algorithm_version',p_payload->>'notes','reviewed',p_request_id,payload_hash)
    on conflict on constraint assessments_save_request_unique do nothing returning * into saved;
    created:=found;
    if created then
      insert into public.gait_metrics(assessment_id,duration_seconds,estimated_steps,cadence_spm,speed_mps,quality,limitations)
      values(saved.id,(p_payload->>'duration_seconds')::numeric,(p_payload->>'estimated_steps')::integer,
        (p_payload->>'cadence_spm')::numeric,(p_payload->>'speed_mps')::numeric,quality,p_payload->>'limitations');
    else
      -- A concurrent identical request may have committed while the unique index waited.
      select * into saved from public.assessments a where a.organization_id=p_organization_id
        and a.professional_id=actor and a.save_request_id=p_request_id;
    end if;
  else created:=false;
  end if;
  if saved.id is null or saved.save_request_hash is distinct from payload_hash
  then raise exception using errcode='PT409',message='Save key conflicts with another payload'; end if;
  if not exists(select 1 from public.gait_metrics m where m.assessment_id=saved.id)
  then raise exception using errcode='PT409',message='Saved record requires investigation'; end if;
  return jsonb_build_object('assessment',to_jsonb(saved)-'save_request_id'-'save_request_hash',
    'request_id',p_request_id,'metrics_saved',true,'replayed',not created);
end $$;
revoke all on function public.save_gait_assessment(uuid,uuid,jsonb) from public,anon;
grant execute on function public.save_gait_assessment(uuid,uuid,jsonb) to authenticated;
commit;
