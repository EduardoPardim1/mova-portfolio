-- Private video storage: browser uploads only through signed URLs issued after assessment authorization.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values ('assessment-videos','assessment-videos',false,524288000,array['video/mp4','video/webm','video/quicktime']) on conflict (id) do nothing;
create policy "member reads own organization videos" on storage.objects for select using (bucket_id='assessment-videos' and public.is_member((storage.foldername(name))[1]::uuid));
create table public.app_admins (user_id uuid primary key references public.profiles(id) on delete cascade, created_at timestamptz not null default now());
alter table public.app_admins enable row level security;
create policy app_admin_self_check on public.app_admins for select using (user_id=auth.uid());
insert into public.plans(id,name,features,active) values ('demo','Demonstração','{"assessments_per_month": 3}'::jsonb,true),('professional','Profissional','{"reports": true}'::jsonb,true),('clinic','Clínicas','{"team_members": true}'::jsonb,true) on conflict (id) do update set name=excluded.name,features=excluded.features,active=excluded.active;
