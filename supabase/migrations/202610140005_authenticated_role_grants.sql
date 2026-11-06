-- Required SQL privileges for authenticated clients; RLS remains the authorization boundary.
grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.organizations, public.organization_members, public.plans, public.subscriptions, public.audit_logs, public.app_admins to authenticated;
grant select, insert, update on public.patients, public.assessments, public.assessment_videos to authenticated;
grant select, insert on public.gait_metrics, public.reports to authenticated;
