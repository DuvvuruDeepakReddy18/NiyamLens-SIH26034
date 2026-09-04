import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { createWorkspaceClient } from './lib/workspaceClient.mjs'
import './workspace.css'
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
const client = url && key ? createClient(url, key) : null

export function WorkspaceGate({ children }) {
  const [session, setSession] = useState(null)
  const [memberships, setMemberships] = useState([])
  const [membershipUserId, setMembershipUserId] = useState('')
  const [org, setOrg] = useState('')
  const [loading, setLoading] = useState(Boolean(client))
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [busy, setBusy] = useState(false)
  const [offlineIdentity, setOfflineIdentity] = useState(false)
  const activeApi = useRef(null)
  useEffect(() => {
    if (!client) return
    let live = true
    client.auth.getSession().then(({ data, error: issue }) => { if (live) { setSession(data.session); setError(issue?.message || ''); setLoading(false) } })
    const { data } = client.auth.onAuthStateChange((event, next) => {
      if (activeApi.current && activeApi.current.expectedUserId !== next?.user.id) activeApi.current.dispose()
      setSession(next)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
    })
    return () => { live = false; data.subscription.unsubscribe() }
  }, [])
  useEffect(() => {
    if (!session) { setMemberships([]); setMembershipUserId(''); setOrg(''); setLoading(false); return }
    let live = true
    setLoading(true)
    const cacheKey = `niyamlens:membership:${session.user.id}`
    client.from('memberships').select('org_id,role,display_name').eq('user_id', session.user.id).eq('active', true).then(({ data, error: issue }) => {
      if (!live) return
      let rows = data || []
      setOfflineIdentity(false)
      if (issue && !navigator.onLine) {
        try { rows = JSON.parse(localStorage.getItem(cacheKey) || '[]'); setOfflineIdentity(true) } catch { rows = [] }
      } else if (!issue) { try { localStorage.setItem(cacheKey, JSON.stringify(rows)) } catch { /* Online use still works without an identity cache. */ } }
      setMemberships(rows); setMembershipUserId(session.user.id); setOrg(rows[0]?.org_id || ''); setError(issue && navigator.onLine ? issue.message : ''); setLoading(false)
    })
    return () => { live = false }
  }, [session?.user.id])
  const member = membershipUserId === session?.user.id ? memberships.find((item) => item.org_id === org) : null
  const workspace = useMemo(() => member && session ? {
    scope: `${org}-${session.user.id}`, org, client, api: createWorkspaceClient(client, org, session.user.id),
    actor: { id: session.user.id, name: member.display_name || session.user.email, role: member.role },
  } : null, [member, org, session?.user.id])
  useEffect(() => {
    // cancelPending is reusable across StrictMode's setup/cleanup replay.
    // Identity changes permanently dispose the old instance in the Auth callback.
    const api = workspace?.api || null
    if (activeApi.current && activeApi.current !== api) activeApi.current.dispose()
    activeApi.current = api
    return () => api?.cancelPending()
  }, [workspace?.api])
  if (!client) return <><div className="workspace-strip"><b>Local workspace</b><span>Cloud not configured · evidence stays in this browser. Local roles are training controls, not authentication.</span></div>{children(null)}</>
  const action = async (task) => { setBusy(true); setError(''); try { const result = await task(); if (result?.error) throw result.error } catch (issue) { setError(issue.message) } finally { setBusy(false) } }
  if (loading) return <main className="auth-card"><h1>Opening workspace…</h1></main>
  if (!session || recovery) return <main className="auth-card"><span className="eyebrow">NIYAMLENS · SECURE WORKSPACE</span><h1>{recovery ? 'Set your password' : 'Sign in'}</h1><p>Accounts and roles are provisioned by your workspace administrator. No self-assigned supervisor access.</p><form onSubmit={(event) => { event.preventDefault(); action(async () => { const result = recovery ? await client.auth.updateUser({ password }) : await client.auth.signInWithPassword({ email, password }); if (!result.error) { setRecovery(false); setPassword('') } return result }) }}>
    {!recovery && <label>Email<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
    <label>Password<input type="password" autoComplete={recovery ? 'new-password' : 'current-password'} minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <button disabled={busy}>{busy ? 'Please wait…' : recovery ? 'Save password' : 'Sign in'}</button>
    {!recovery && <button type="button" disabled={busy || !email} onClick={() => action(async () => { const result = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin }); if (!result.error) setError('If this account exists, check its email for a recovery link.'); return result })}>Send password reset</button>}
    <p role="status">{error}</p>
  </form></main>
  if (!workspace) return <main className="auth-card"><h1>No workspace membership</h1><p>Your administrator must add this account to an active workspace.</p><p role="alert">{error}</p><button onClick={() => action(() => client.auth.signOut())}>Sign out</button></main>
  return <><div className="workspace-strip"><b>{workspace.actor.name} · {workspace.actor.role}</b>{memberships.length > 1 && <select aria-label="Workspace" value={org} onChange={(event) => setOrg(event.target.value)}>{memberships.map((item) => <option key={item.org_id}>{item.org_id}</option>)}</select>}<span>{offlineIdentity ? 'Offline identity cache — all server permissions rechecked on reconnect.' : 'Authenticated workspace · server-verified permissions'}<br />Offline evidence remains on this device after sign-out; use a trusted device.</span><button onClick={() => setRecovery(true)}>Change password</button><button onClick={() => action(() => client.auth.signOut())}>Sign out</button></div>{error && <p className="workspace-error" role="alert">{error}</p>}{children(workspace)}</>
}

export function SharedOperations({ workspace, history, onOpenReport, onOverride }) {
  const [assignments, setAssignments] = useState([])
  const [members, setMembers] = useState([])
  const [officer, setOfficer] = useState('')
  const [packageRef, setPackageRef] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const reviewer = ['admin', 'supervisor'].includes(workspace.actor.role)
  const refresh = async () => {
    const rows = []; let offset = 0
    do { const result = await workspace.api.request(`assignments?offset=${offset}`); rows.push(...result.assignments); offset = result.nextOffset } while (offset !== null)
    setAssignments(rows)
  }
  const run = async (action) => { setBusy(true); setError(''); try { await action(); await refresh() } catch (issue) { setError(issue.message) } finally { setBusy(false) } }
  useEffect(() => {
    run(async () => {
      if (reviewer) {
        const { data, error: issue } = await workspace.client.from('memberships').select('user_id,display_name,role').eq('org_id', workspace.org).eq('active', true)
        if (issue) throw issue
        setMembers(data || []); setOfficer(data?.[0]?.user_id || '')
      }
    })
  }, [workspace.scope])
  return <section className="shared-operations"><h2>Shared officer operations</h2><p>Sealed automated findings are immutable. Reviews append a disposition; stale reviews require conflict resolution.</p><p role="alert">{error}</p>
    <article className="ops-card"><h3>Assignments</h3><button disabled={busy} onClick={() => run(async () => {})}>Refresh assignments</button>{reviewer && <form className="assignment-form" onSubmit={(event) => { event.preventDefault(); run(async () => { await workspace.api.request('assignments', { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), officerId: officer, packageRef }) }); setPackageRef('') }) }}><select aria-label="Assigned officer" value={officer} onChange={(event) => setOfficer(event.target.value)}>{members.map((item) => <option key={item.user_id} value={item.user_id}>{item.display_name || item.user_id} ({item.role})</option>)}</select><input aria-label="Package reference" required maxLength={300} value={packageRef} onChange={(event) => setPackageRef(event.target.value)} placeholder="Premises / package reference" /><button disabled={busy || !officer}>Assign</button></form>}
    {assignments.map((item) => <div className="shared-row" key={item.id}><span><b>{item.package_ref}</b><small>Version {item.version} · {item.officer_id}</small></span><span>{item.status}</span><select aria-label={`Change assignment ${item.package_ref}`} value={item.status} disabled={busy || item.status === 'closed'} onChange={(event) => run(() => workspace.api.request('assignments', { method: 'PATCH', body: JSON.stringify({ id: item.id, status: event.target.value, version: item.version }) }))}><option value="assigned">Assigned</option><option value="in_progress">In progress</option><option value="submitted">Submitted</option>{reviewer && <option value="closed">Closed</option>}</select></div>)}</article>
    <article className="ops-card"><h3>Case review queue</h3>{history.map((record) => <div className="shared-row" key={record.id}><span><b>{record.meta.productName || record.id}</b><small>{record.syncState || 'Local'} · server v{record.serverVersion || '—'}</small></span><button onClick={() => onOpenReport(record)}>Evidence</button><button disabled={!reviewer || !record.serverVersion || record.syncState !== 'synced'} onClick={() => onOverride(record)}>Review / override</button></div>)}</article>
  </section>
}
