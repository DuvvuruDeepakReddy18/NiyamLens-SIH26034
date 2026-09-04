create extension if not exists pgcrypto with schema extensions;

create table public.organizations (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz not null default now());
create table public.memberships (
  org_id uuid references public.organizations(id), user_id uuid references auth.users(id),
  role text not null check (role in ('officer','supervisor','admin')), active boolean not null default true,
  display_name text not null default '', primary key(org_id,user_id)
);
create function public.has_membership(target uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from memberships where org_id=target and user_id=auth.uid() and active);
$$;
create function public.can_review(target uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from memberships where org_id=target and user_id=auth.uid() and active and role in ('supervisor','admin'));
$$;
create table public.cases (
  org_id uuid references public.organizations(id), id text not null check(length(id) between 8 and 100),
  owner_id uuid not null references auth.users(id), payload jsonb not null, payload_hash text not null,
  version integer not null default 1, created_at timestamptz not null default now(), primary key(org_id,id)
);
create table public.case_reviews (
  id uuid primary key, org_id uuid not null, case_id text not null, actor_id uuid not null references auth.users(id),
  status text not null check(status in ('compliant','non_compliant','manual_review','exempt')),
  reason text not null check(length(reason) between 12 and 4000), created_at timestamptz not null default now(),
  foreign key(org_id,case_id) references public.cases(org_id,id)
);
create table public.evidence_objects (
  path text primary key, org_id uuid not null references public.organizations(id), owner_id uuid not null references auth.users(id),
  case_id text not null, panel_id text not null, kind text not null check(kind in ('original','analysis')),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), bytes integer not null check(bytes > 0 and bytes <= 15728640),
  mime text not null check(mime in ('image/jpeg','image/png','image/webp')), verified_at timestamptz not null default now()
);
create table public.assignments (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
  officer_id uuid not null references auth.users(id), creator_id uuid not null references auth.users(id),
  package_ref text not null check(length(package_ref) between 1 and 300), status text not null default 'assigned' check(status in ('assigned','in_progress','submitted','closed')),
  version integer not null default 1, case_id text, created_at timestamptz not null default now()
);
create table public.server_audit (
  org_id uuid not null references public.organizations(id), sequence bigint not null, actor_id uuid not null,
  event text not null, details jsonb not null, previous_hash text not null, hash text not null,
  created_at timestamptz not null, primary key(org_id,sequence)
);
create table public.request_counters (key text primary key, count integer not null, expires_at timestamptz not null);

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.cases enable row level security;
alter table public.case_reviews enable row level security;
alter table public.evidence_objects enable row level security;
alter table public.assignments enable row level security;
alter table public.server_audit enable row level security;
alter table public.request_counters enable row level security;
revoke all on public.organizations,public.memberships,public.cases,public.case_reviews,public.evidence_objects,public.assignments,public.server_audit,public.request_counters from anon,authenticated;
grant select on public.organizations,public.memberships,public.cases,public.case_reviews,public.evidence_objects,public.assignments,public.server_audit to authenticated;
create policy org_read on public.organizations for select to authenticated using(public.has_membership(id));
create policy member_read on public.memberships for select to authenticated using(user_id=auth.uid() or public.can_review(org_id));
create policy case_read on public.cases for select to authenticated using(public.has_membership(org_id) and (owner_id=auth.uid() or public.can_review(org_id)));
create policy review_read on public.case_reviews for select to authenticated using(exists(select 1 from public.cases c where c.org_id=case_reviews.org_id and c.id=case_id));
create policy evidence_read on public.evidence_objects for select to authenticated using(public.has_membership(org_id) and (owner_id=auth.uid() or public.can_review(org_id)));
create policy assignment_read on public.assignments for select to authenticated using(public.has_membership(org_id) and (officer_id=auth.uid() or public.can_review(org_id)));
create policy audit_read on public.server_audit for select to authenticated using(public.can_review(org_id));

create function public.append_server_audit(p_org uuid,p_actor uuid,p_event text,p_details jsonb) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare prev text; seq bigint; stamp timestamptz:=clock_timestamp(); next_hash text;
begin
  perform 1 from organizations where id=p_org for update;
  select hash,sequence into prev,seq from server_audit where org_id=p_org order by sequence desc limit 1;
  prev:=coalesce(prev,'GENESIS'); seq:=coalesce(seq,0)+1;
  next_hash:=encode(extensions.digest(convert_to(jsonb_build_object('previous',prev,'sequence',seq,'actor',p_actor,'event',p_event,'details',p_details,'at',stamp)::text,'UTF8'),'sha256'),'hex');
  insert into server_audit values(p_org,seq,p_actor,p_event,p_details,prev,next_hash,stamp);
  return next_hash;
end $$;

create function public.commit_case(p_org uuid,p_actor uuid,p_id text,p_payload jsonb,p_hash text) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare existing cases;
begin
  if not exists(select 1 from memberships where org_id=p_org and user_id=p_actor and active) then raise exception 'Forbidden' using errcode='42501'; end if;
  perform 1 from organizations where id=p_org for update;
  select * into existing from cases where org_id=p_org and id=p_id;
  if found then
    if existing.owner_id=p_actor and existing.payload_hash=p_hash then return existing.version; end if;
    raise exception 'Immutable case already exists' using errcode='40001';
  end if;
  insert into cases(org_id,id,owner_id,payload,payload_hash) values(p_org,p_id,p_actor,p_payload,p_hash);
  perform append_server_audit(p_org,p_actor,'case_sealed',jsonb_build_object('caseId',p_id,'payloadHash',p_hash));
  return 1;
end $$;
create function public.review_case(p_org uuid,p_actor uuid,p_id text,p_operation uuid,p_version integer,p_status text,p_reason text) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare current_version integer;
begin
  if not exists(select 1 from memberships where org_id=p_org and user_id=p_actor and active and role in ('supervisor','admin')) then raise exception 'Forbidden' using errcode='42501'; end if;
  select version into current_version from cases where org_id=p_org and id=p_id for update;
  if not found then raise exception 'Case not found'; end if;
  if exists(select 1 from case_reviews where id=p_operation and org_id=p_org and case_id=p_id and actor_id=p_actor and status=p_status and reason=p_reason) then return current_version; end if;
  if current_version<>p_version then raise exception 'Case changed; refresh before reviewing' using errcode='40001'; end if;
  insert into case_reviews(id,org_id,case_id,actor_id,status,reason) values(p_operation,p_org,p_id,p_actor,p_status,p_reason);
  update cases set version=version+1 where org_id=p_org and id=p_id;
  perform append_server_audit(p_org,p_actor,'case_reviewed',jsonb_build_object('caseId',p_id,'operation',p_operation,'status',p_status));
  return current_version+1;
end $$;
create function public.consume_quota(p_key text,p_limit integer,p_seconds integer) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare total integer; bucket text;
begin
  bucket:=p_key||':'||p_seconds::text||':'||floor(extract(epoch from now())/p_seconds)::text;
  insert into request_counters values(bucket,1,now()+make_interval(secs=>p_seconds*2)) on conflict(key) do update set count=request_counters.count+1 returning count into total;
  return total<=p_limit;
end $$;

revoke all on function public.append_server_audit(uuid,uuid,text,jsonb),public.commit_case(uuid,uuid,text,jsonb,text),public.review_case(uuid,uuid,text,uuid,integer,text,text),public.consume_quota(text,integer,integer) from public,anon,authenticated;
grant execute on function public.append_server_audit(uuid,uuid,text,jsonb),public.commit_case(uuid,uuid,text,jsonb,text),public.review_case(uuid,uuid,text,uuid,integer,text,text),public.consume_quota(text,integer,integer) to service_role;
grant all on public.organizations,public.memberships,public.cases,public.case_reviews,public.evidence_objects,public.assignments,public.server_audit,public.request_counters to service_role;
revoke insert,update,delete on public.cases,public.case_reviews,public.server_audit from service_role;
create index cases_owner_created on public.cases(org_id,owner_id,created_at desc,id);
create index reviews_case_created on public.case_reviews(org_id,case_id,created_at,id);
create index evidence_case on public.evidence_objects(org_id,case_id);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('evidence','evidence',false,15728640,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
-- No authenticated storage write policies: only server-issued exact-path upload tokens are accepted.
