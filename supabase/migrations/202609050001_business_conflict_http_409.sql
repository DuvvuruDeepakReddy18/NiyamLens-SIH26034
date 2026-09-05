-- Business-state conflicts are durable client conflicts, not PostgreSQL
-- serialization failures. PostgREST maps PT409 to HTTP 409 without treating the
-- error as a retryable transaction rollback. Real 40001 database errors retain
-- their existing API mapping in server/security.mjs.

create or replace function public.commit_case(p_org uuid,p_actor uuid,p_id text,p_payload jsonb,p_hash text) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare existing cases;
begin
  if not exists(select 1 from memberships where org_id=p_org and user_id=p_actor and active) then raise exception 'Forbidden' using errcode='42501'; end if;
  perform 1 from organizations where id=p_org for update;
  select * into existing from cases where org_id=p_org and id=p_id;
  if found then
    if existing.owner_id=p_actor and existing.payload_hash=p_hash then return existing.version; end if;
    raise exception 'Immutable case already exists' using errcode='PT409';
  end if;
  insert into cases(org_id,id,owner_id,payload,payload_hash) values(p_org,p_id,p_actor,p_payload,p_hash);
  perform append_server_audit(p_org,p_actor,'case_sealed',jsonb_build_object('caseId',p_id,'payloadHash',p_hash));
  return 1;
end $$;

create or replace function public.review_case(p_org uuid,p_actor uuid,p_id text,p_operation uuid,p_version integer,p_status text,p_reason text) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare current_version integer;
begin
  if not exists(select 1 from memberships where org_id=p_org and user_id=p_actor and active and role in ('supervisor','admin')) then raise exception 'Forbidden' using errcode='42501'; end if;
  select version into current_version from cases where org_id=p_org and id=p_id for update;
  if not found then raise exception 'Case not found'; end if;
  if exists(select 1 from case_reviews where id=p_operation and org_id=p_org and case_id=p_id and actor_id=p_actor and status=p_status and reason=p_reason) then return current_version; end if;
  if current_version<>p_version then raise exception 'Case changed; refresh before reviewing' using errcode='PT409'; end if;
  insert into case_reviews(id,org_id,case_id,actor_id,status,reason) values(p_operation,p_org,p_id,p_actor,p_status,p_reason);
  update cases set version=version+1 where org_id=p_org and id=p_id;
  perform append_server_audit(p_org,p_actor,'case_reviewed',jsonb_build_object('caseId',p_id,'operation',p_operation,'status',p_status));
  return current_version+1;
end $$;

create or replace function public.create_assignment(p_org uuid,p_actor uuid,p_id uuid,p_officer uuid,p_reference text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare existing assignments;
begin
  if not exists(select 1 from memberships where org_id=p_org and user_id=p_actor and active and role in ('supervisor','admin')) then raise exception 'Forbidden' using errcode='42501'; end if;
  if not exists(select 1 from memberships where org_id=p_org and user_id=p_officer and active) then raise exception 'Assignee inactive' using errcode='42501'; end if;
  perform 1 from organizations where id=p_org for update;
  select * into existing from assignments where id=p_id;
  if found then
    if existing.org_id=p_org and existing.creator_id=p_actor and existing.officer_id=p_officer and existing.package_ref=p_reference then return p_id; end if;
    raise exception 'Assignment ID already used' using errcode='PT409';
  end if;
  insert into assignments(id,org_id,officer_id,creator_id,package_ref) values(p_id,p_org,p_officer,p_actor,p_reference);
  perform append_server_audit(p_org,p_actor,'assignment_created',jsonb_build_object('assignmentId',p_id,'officerId',p_officer));
  return p_id;
end $$;

create or replace function public.update_assignment(p_org uuid,p_actor uuid,p_id uuid,p_version integer,p_status text) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare existing assignments; actor_role text;
begin
  select role into actor_role from memberships where org_id=p_org and user_id=p_actor and active;
  if actor_role is null then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into existing from assignments where id=p_id and org_id=p_org for update;
  if not found or (actor_role='officer' and existing.officer_id<>p_actor) then raise exception 'Forbidden' using errcode='42501'; end if;
  if existing.version<>p_version then raise exception 'Assignment changed; refresh before retrying' using errcode='PT409'; end if;
  if not ((existing.status='assigned' and p_status='in_progress') or (existing.status='in_progress' and p_status='submitted') or (existing.status='submitted' and p_status in ('closed','in_progress') and actor_role in ('supervisor','admin'))) then raise exception 'Invalid assignment transition' using errcode='PT409'; end if;
  update assignments set status=p_status,version=version+1 where id=p_id;
  perform append_server_audit(p_org,p_actor,'assignment_updated',jsonb_build_object('assignmentId',p_id,'status',p_status,'version',p_version+1));
  return p_version+1;
end $$;

revoke all on function public.commit_case(uuid,uuid,text,jsonb,text),public.review_case(uuid,uuid,text,uuid,integer,text,text),public.create_assignment(uuid,uuid,uuid,uuid,text),public.update_assignment(uuid,uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.commit_case(uuid,uuid,text,jsonb,text),public.review_case(uuid,uuid,text,uuid,integer,text,text),public.create_assignment(uuid,uuid,uuid,uuid,text),public.update_assignment(uuid,uuid,uuid,integer,text) to service_role;
