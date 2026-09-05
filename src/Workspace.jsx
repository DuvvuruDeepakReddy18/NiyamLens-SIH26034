import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { createWorkspaceClient } from './lib/workspaceClient.mjs'
import { nextPageOffset } from './lib/inspectionWorkflow.mjs'
import { canOpenOfflineIdentity, createOfflineWorkspaceApi, forgetOfflineIdentity, isLocalSignoutLocked, isRetryableIdentityFailure, lockLocalSignout, readOfflineIdentity, rememberOfflineSelection, rememberVerifiedIdentity, unlockAfterSignIn } from './lib/offlineIdentity.mjs'
import { Camera, Check, FileSearch, LockKeyhole, Ruler, ScanLine, ShieldCheck } from 'lucide-react'
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
  const [online, setOnline] = useState(() => navigator.onLine)
  const [offlineIdentity, setOfflineIdentity] = useState(() => !navigator.onLine ? readOfflineIdentity(localStorage, { projectUrl: url }) : null)
  const [retryableVerificationFailure, setRetryableVerificationFailure] = useState(false)
  const activeApi = useRef(null)
  const authEpoch = useRef(0)
  const currentAuthKey = useRef('')
  const signedOut = useRef(false)
  const explicitLocalMode = useRef(false)
  const connectivity = () => {
    authEpoch.current += 1; currentAuthKey.current = ''; explicitLocalMode.current = false
    activeApi.current?.dispose()
    setMemberships([]); setMembershipUserId('')
    setSession(null); setRecovery(false); setError(''); setRetryableVerificationFailure(false)
    const connected = navigator.onLine
    setOnline(connected); setLoading(connected)
    setOfflineIdentity(!connected && !signedOut.current ? readOfflineIdentity(localStorage, { projectUrl: url }) : null)
  }
  useEffect(() => {
    if (!client) return
    window.addEventListener('online', connectivity)
    window.addEventListener('offline', connectivity)
    const { data } = client.auth.onAuthStateChange((event, next) => {
      if (activeApi.current && activeApi.current.expectedUserId !== next?.user.id) activeApi.current.dispose()
      // Offline continuity does not depend on the SDK refreshing an expired
      // token. A valid lease never becomes a substitute Auth session.
      if (!navigator.onLine || explicitLocalMode.current) return
      if (isLocalSignoutLocked(localStorage) && next && event !== 'PASSWORD_RECOVERY') return
      const identity = next ? `${next.user.id}:${next.access_token}` : ''
      if (identity === currentAuthKey.current && !['SIGNED_OUT', 'PASSWORD_RECOVERY'].includes(event)) return
      currentAuthKey.current = identity
      authEpoch.current += 1
      const cached = readOfflineIdentity(localStorage, { projectUrl: url })
      if (event === 'SIGNED_OUT' || (next?.user.id && cached && cached.user.id !== next.user.id)) forgetOfflineIdentity(localStorage)
      if (event === 'SIGNED_OUT') { signedOut.current = true; setOfflineIdentity(null); setMemberships([]); setMembershipUserId(''); setOrg('') }
      if (next) signedOut.current = false
      setRetryableVerificationFailure(false)
      setSession(next)
      if (!next) setLoading(false)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
    })
    return () => { data.subscription.unsubscribe(); window.removeEventListener('online', connectivity); window.removeEventListener('offline', connectivity) }
  }, [])
  useEffect(() => {
    if (!client || !online || isLocalSignoutLocked(localStorage)) { setLoading(false); return }
    let live = true
    const epoch = authEpoch.current
    const timer = setTimeout(() => { if (live && epoch === authEpoch.current) { authEpoch.current += 1; setLoading(false); setRetryableVerificationFailure(true); setError('Sign-in verification timed out. Retry when the connection is available.'); setSession(null) } }, 15000)
    client.auth.getSession().then(({ data, error: issue }) => {
      if (!live || epoch !== authEpoch.current) return
      clearTimeout(timer)
      const cached = readOfflineIdentity(localStorage, { projectUrl: url })
      if (data.session?.user.id && cached && cached.user.id !== data.session.user.id) forgetOfflineIdentity(localStorage)
      currentAuthKey.current = data.session ? `${data.session.user.id}:${data.session.access_token}` : ''
      setSession(data.session); setError(issue?.message || '')
      const retryable = isRetryableIdentityFailure(issue)
      setRetryableVerificationFailure(retryable)
      if (!data.session) { if (!retryable) forgetOfflineIdentity(localStorage); setOfflineIdentity(null); setLoading(false) }
    }).catch(issue => { if (live && epoch === authEpoch.current) { clearTimeout(timer); const retryable = isRetryableIdentityFailure(issue); if (!retryable) forgetOfflineIdentity(localStorage); setRetryableVerificationFailure(retryable); setSession(null); setLoading(false); setError('Unable to verify sign-in. Check your connection and sign in again.') } })
    return () => { live = false; clearTimeout(timer) }
  }, [online])
  useEffect(() => {
    if (!client || !online || !session) { setMemberships([]); setMembershipUserId(''); return }
    let live = true
    setLoading(true)
    setMembershipUserId('')
    const epoch = authEpoch.current
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    client.from('memberships').select('org_id,role,display_name').eq('user_id', session.user.id).eq('active', true).abortSignal(controller.signal).then(({ data, error: issue, status }) => {
      if (!live || epoch !== authEpoch.current || signedOut.current || !navigator.onLine) return
      clearTimeout(timer)
      const rows = issue ? [] : data || []
      const retryable = Boolean(issue && isRetryableIdentityFailure(issue, status))
      setRetryableVerificationFailure(retryable)
      setOfflineIdentity(null)
      const previousPreference = readOfflineIdentity(localStorage, { projectUrl: url, expectedUserId: session.user.id })?.preferredOrg
      const preferredOrg = rows.some(row => row.org_id === org) ? org : rows.some(row => row.org_id === previousPreference) ? previousPreference : rows[0]?.org_id || ''
      if (!issue && rows.length) rememberVerifiedIdentity(localStorage, { projectUrl: url, user: session.user, memberships: rows, preferredOrg })
      else if (!retryable) forgetOfflineIdentity(localStorage)
      // Retire the former unbounded membership-only cache for this identity.
      try { localStorage.removeItem(`niyamlens:membership:${session.user.id}`) } catch { /* Private evidence is unaffected. */ }
      setMemberships(rows); setMembershipUserId(session.user.id); setOrg(preferredOrg); setError(issue?.message || ''); setLoading(false)
    }).catch(issue => { if (live && epoch === authEpoch.current) { clearTimeout(timer); const retryable = isRetryableIdentityFailure(issue); if (!retryable) forgetOfflineIdentity(localStorage); setRetryableVerificationFailure(retryable); setOfflineIdentity(null); setMemberships([]); setMembershipUserId(''); setError('Membership verification failed. Reconnect and sign in again.'); setLoading(false) } })
    return () => { live = false; clearTimeout(timer); controller.abort() }
  }, [online, session?.user.id, session?.access_token])
  const lease = canOpenOfflineIdentity(offlineIdentity, { online, projectUrl: url })
  useEffect(() => {
    if (!lease) return
    const timer = setTimeout(() => { activeApi.current?.dispose(); setOfflineIdentity(null); setError('Offline access expired. Reconnect and sign in to reopen this workspace. Your evidence is retained.') }, Math.max(0, lease.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [lease])
  const visibleMemberships = lease?.memberships || memberships
  const selectedOrg = lease ? (lease.memberships.some(item => item.org_id === org) ? org : lease.preferredOrg) : org
  const member = lease ? lease.memberships.find(item => item.org_id === selectedOrg) : online && membershipUserId === session?.user.id ? memberships.find((item) => item.org_id === org) : null
  const workspace = useMemo(() => {
    if (!member) return null
    if (lease) return {
      scope: `${selectedOrg}-${lease.user.id}`, org: selectedOrg, client: null, api: createOfflineWorkspaceApi(lease.user.id),
      offlineOnly: true, offlineLeaseExpiresAt: lease.expiresAt,
      actor: { id: lease.user.id, name: member.display_name || lease.user.label, role: 'officer' },
    }
    return session ? { scope: `${org}-${session.user.id}`, org, client, api: createWorkspaceClient(client, org, session.user.id), offlineOnly: false,
      actor: { id: session.user.id, name: member.display_name || session.user.email, role: member.role } } : null
  }, [member, selectedOrg, org, lease, session?.user.id])
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
  const fallbackIdentity = retryableVerificationFailure && !signedOut.current ? readOfflineIdentity(localStorage, { projectUrl: url, expectedUserId: session?.user.id }) : null
  const openCachedLocalWork = () => {
    if (!fallbackIdentity) return
    explicitLocalMode.current = true; authEpoch.current += 1; activeApi.current?.dispose()
    setSession(null); setMemberships([]); setMembershipUserId(''); setOnline(false); setOfflineIdentity(fallbackIdentity); setLoading(false); setError('')
  }
  const cachedLocalButton = fallbackIdentity ? <button type="button" onClick={openCachedLocalWork}>Open cached local work</button> : null
  const selectWorkspace = (nextOrg) => {
    if (!visibleMemberships.some(member => member.org_id === nextOrg)) return
    setOrg(nextOrg)
    const updated = rememberOfflineSelection(localStorage, nextOrg, { projectUrl: url, expectedUserId: workspace?.actor.id })
    if (workspace?.offlineOnly && updated) setOfflineIdentity(updated)
  }
  const signOut = async () => {
    signedOut.current = true; authEpoch.current += 1; currentAuthKey.current = ''; activeApi.current?.dispose()
    lockLocalSignout(localStorage); setOfflineIdentity(null); setSession(null); setMemberships([]); setMembershipUserId(''); setOrg(''); setRecovery(false); setLoading(false)
    // The SDK clears only Auth state; original images and the local outbox stay.
    return client.auth.signOut({ scope: 'local' })
  }
  if (loading) return <main className="auth-card"><h1>Opening workspace…</h1></main>
  if ((!session && !lease) || recovery) return <main className="auth-shell">
    <section className="auth-context" aria-labelledby="auth-product-title">
      <div className="auth-brand"><span aria-hidden="true"><FileSearch size={26} /></span><div><strong>NiyamLens</strong><small>Inspection intelligence</small></div></div>
      <span className="eyebrow">SIH26034 · LEGAL METROLOGY</span>
      <h1 id="auth-product-title">From package image to defensible evidence.</h1>
      <p>Evidence-grade packaged-commodity inspection that keeps OCR, encoded rules and human judgment in their proper roles.</p>
      <ol className="auth-flow" aria-label="NiyamLens inspection chain">
        {[[Camera, 'Capture'], [ScanLine, 'Recognize'], [FileSearch, 'Verify'], [Ruler, 'Measure'], [ShieldCheck, 'Evaluate'], [LockKeyhole, 'Seal']].map(([Icon, label]) => <li key={label}><span><Icon size={16} /></span><b>{label}</b></li>)}
      </ol>
      <div className="auth-boundary"><Check size={18} /><span><b>OCR proposes evidence. Rules evaluate supplied facts. Officers decide.</b><small>No self-assigned roles · no automatic statutory determination</small></span></div>
    </section>
    <article className="auth-card"><span className="eyebrow">SECURE WORKSPACE</span><h2>{recovery ? 'Set your password' : 'Officer sign in'}</h2><p>{!online ? 'No valid offline access remains on this device. Reconnect and sign in; your saved evidence is retained.' : 'Accounts and roles are provisioned by your workspace administrator. No self-assigned supervisor access.'}</p><form onSubmit={(event) => { event.preventDefault(); if (!online) return; action(async () => { const result = recovery ? await client.auth.updateUser({ password }) : await client.auth.signInWithPassword({ email, password }); if (!result.error) { unlockAfterSignIn(localStorage); signedOut.current = false; if (result.data?.session) { currentAuthKey.current = `${result.data.session.user.id}:${result.data.session.access_token}`; setSession(result.data.session) } setRecovery(false); setPassword('') } return result }) }}>
      {!recovery && <label>Email<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
      <label>Password<input type="password" autoComplete={recovery ? 'new-password' : 'current-password'} minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <button disabled={busy || !online}>{busy ? 'Please wait…' : recovery ? 'Save password' : 'Sign in securely'}</button>
      {!recovery && <button className="auth-secondary" type="button" disabled={busy || !email || !online} onClick={() => action(async () => { const result = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin }); if (!result.error) setError('If this account exists, check its email for a recovery link.'); return result })}>Send password reset</button>}
      <p role="status">{error}</p>
    </form>{cachedLocalButton}</article>
  </main>
  if (!workspace) return <main className="auth-card"><h1>{retryableVerificationFailure ? 'Workspace verification unavailable' : 'No workspace membership'}</h1><p>{retryableVerificationFailure ? 'The identity service could not be reached. Cached local work is available only while its existing lease remains valid.' : 'Your administrator must add this account to an active workspace.'}</p><p role="alert">{error}</p>{cachedLocalButton}<button onClick={() => action(signOut)}>Sign out</button></main>
  return <><div className="workspace-strip"><b>{workspace.actor.name} · {workspace.actor.role}</b>{visibleMemberships.length > 1 && <select aria-label="Workspace" value={selectedOrg} onChange={(event) => selectWorkspace(event.target.value)}>{visibleMemberships.map((item) => <option key={item.org_id}>{item.org_id}</option>)}</select>}<span>{workspace.offlineOnly ? `Offline local work only · access expires ${new Date(workspace.offlineLeaseExpiresAt).toLocaleString()}. Cloud actions and supervisor reviews require fresh sign-in verification.` : 'Authenticated workspace · server-verified permissions'}<br />Offline evidence remains on this device after sign-out; use a trusted device.</span>{workspace.offlineOnly && <button onClick={connectivity}>Recheck connection</button>}<button disabled={workspace.offlineOnly} onClick={() => setRecovery(true)}>Change password</button><button onClick={() => action(signOut)}>Sign out</button></div>{error && <p className="workspace-error" role="alert">{error}</p>}{children(workspace)}</>
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
    const rows = []; let offset = 0; let pageNumber = 0
    do {
      const result = await workspace.api.request(`assignments?offset=${offset}`)
      rows.push(...result.assignments)
      if (result.paginationLimited) setError('Assignment results reached the server limit and are partial. Contact your administrator to narrow the query.')
      offset = nextPageOffset(offset, result.nextOffset, pageNumber++)
    } while (offset !== null)
    setAssignments(rows)
  }
  const run = async (action) => { setBusy(true); setError(''); try { await action(); await refresh() } catch (issue) { setError(issue.message) } finally { setBusy(false) } }
  useEffect(() => {
    if (workspace.offlineOnly) { setAssignments([]); setMembers([]); setError(''); return }
    run(async () => {
      if (reviewer) {
        const { data, error: issue } = await workspace.client.from('memberships').select('user_id,display_name,role').eq('org_id', workspace.org).eq('active', true)
        if (issue) throw issue
        setMembers(data || []); setOfficer(data?.[0]?.user_id || '')
      }
    })
  }, [workspace.scope, workspace.offlineOnly])
  if (workspace.offlineOnly) return <section className="shared-operations"><h2>Shared officer operations</h2><p>Offline local work is available. Assignments, cloud retrieval and supervisor dispositions require a fresh online membership check. Local case drafts stay on this device until then.</p></section>
  return <section className="shared-operations"><h2>Shared officer operations</h2><p>Sealed automated findings are immutable. Reviews append a disposition; stale reviews require conflict resolution.</p><p role="alert">{error}</p>
    <article className="ops-card"><h3>Assignments</h3><button disabled={busy} onClick={() => run(async () => {})}>Refresh assignments</button>{reviewer && <form className="assignment-form" onSubmit={(event) => { event.preventDefault(); run(async () => { await workspace.api.request('assignments', { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), officerId: officer, packageRef }) }); setPackageRef('') }) }}><select aria-label="Assigned officer" value={officer} onChange={(event) => setOfficer(event.target.value)}>{members.map((item) => <option key={item.user_id} value={item.user_id}>{item.display_name || item.user_id} ({item.role})</option>)}</select><input aria-label="Package reference" required maxLength={300} value={packageRef} onChange={(event) => setPackageRef(event.target.value)} placeholder="Premises / package reference" /><button disabled={busy || !officer}>Assign</button></form>}
    {assignments.map((item) => <div className="shared-row" key={item.id}><span><b>{item.package_ref}</b><small>Version {item.version} · {item.officer_id}</small></span><span>{item.status}</span><select aria-label={`Change assignment ${item.package_ref}`} value={item.status} disabled={busy || item.status === 'closed'} onChange={(event) => run(() => workspace.api.request('assignments', { method: 'PATCH', body: JSON.stringify({ id: item.id, status: event.target.value, version: item.version }) }))}><option value="assigned">Assigned</option><option value="in_progress">In progress</option><option value="submitted">Submitted</option>{reviewer && <option value="closed">Closed</option>}</select></div>)}</article>
    <article className="ops-card"><h3>Case review queue</h3>{history.map((record) => <div className="shared-row" key={record.id}><span><b>{record.meta.productName || record.id}</b><small>{record.syncState || 'Local'} · server v{record.serverVersion || '—'}</small></span><button onClick={() => onOpenReport(record)}>Evidence</button><button disabled={!reviewer || !record.serverVersion || record.syncState !== 'synced'} onClick={() => onOverride(record)}>Review / override</button></div>)}</article>
  </section>
}
