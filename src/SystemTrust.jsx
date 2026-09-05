import { Check, Cloud, Database, Download, HardDrive, Info, LockKeyhole, ScanLine, ShieldCheck, Wifi, WifiOff } from 'lucide-react'

const syncLabel = (value) => value
  ? `Verified this session · ${new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
  : 'Not verified this session'

export default function SystemTrust({ workspace, online, install, historyCount, lastSyncAt, onNavigate }) {
  const managed = Boolean(workspace)
  const shellState = {
    ready: { label: 'Offline shell and OCR pack verified', copy: 'The app shell and every required Tesseract worker, runtime and language asset were matched in their independent Cache Storage sets. Optional engines and cloud operations can still require a network.', tone: 'good' },
    checking: { label: 'Checking offline shell…', copy: 'Waiting for the service worker to finish installing and verifying essential cached assets.', tone: '' },
    downloading: { label: 'Downloading browser OCR pack…', copy: `${install.shellProgress.completed}/${install.shellProgress.total || '…'} required assets cached. Keep this page open.`, tone: '' },
    incomplete: { label: 'Offline shell incomplete', copy: 'The service worker is active, but one or more essential local OCR assets were not found in Cache Storage. Reconnect and reload before field use.', tone: '' },
    unavailable: { label: 'Offline shell not verified', copy: 'This browser session has not verified a service worker and its essential local OCR cache. Online use can still continue.', tone: '' },
  }[install.shell] || { label: 'Offline shell status unknown', copy: 'Verify offline operation on this device before field use.', tone: '' }
  const runtime = [
    { icon: online ? Wifi : WifiOff, label: 'Device network', value: online ? 'Browser reports online' : 'Browser reports offline', detail: online ? 'This does not prove that every cloud service is reachable.' : 'Capture, local OCR and drafts remain available only after the offline OCR pack is verified on this device.' },
    { icon: HardDrive, label: 'Local evidence', value: `${historyCount} inspection${historyCount === 1 ? '' : 's'} in this workspace`, detail: managed ? 'Local records are isolated by organization and signed-in user.' : 'Records remain in this browser profile until explicitly removed.' },
    { icon: managed ? Cloud : Database, label: 'Workspace mode', value: workspace?.offlineOnly ? 'Limited offline workspace' : managed ? 'Managed cloud workspace' : 'Local-only workspace', detail: workspace?.offlineOnly ? 'Token-free, time-limited local identity cache. No cloud operations or supervisor privileges; reconnect requires fresh authentication and membership checks.' : managed ? 'Sealed evidence is queued locally, then uploaded to private storage and server-verified.' : 'No managed evidence upload is attempted.' },
    ...(managed ? [{ icon: Cloud, label: 'Server sync', value: syncLabel(lastSyncAt), detail: lastSyncAt ? 'A server request, remote merge and local refresh completed without error.' : online ? 'Browser connectivity alone is not counted as a verified server sync.' : 'Reconnect, then use Sync / retry to verify the server copy.' }] : []),
    { icon: ScanLine, label: 'OCR boundary', value: 'Browser OCR is the private default', detail: 'Connected OCR sends processed panels to Google Vision only after an explicit click.' },
  ]

  return (
    <section className="system-page page-enter">
      <div className="page-intro system-intro"><div><span className="eyebrow">SYSTEM & TRUST</span><h2>Know what is local, connected and still unverified.</h2><p>NiyamLens is decision support for packaged-commodity inspection. It preserves source evidence and uncertainty; it does not replace statutory inspection or officer judgment.</p></div><div className="system-seal"><ShieldCheck size={25} /><span>Evidence-first</span><small>Human-final</small></div></div>

      <div className="runtime-grid">
        {runtime.map(({ icon: Icon, label, value, detail }) => <article key={label}><Icon size={21} /><span>{label}</span><strong>{value}</strong><p>{detail}</p></article>)}
      </div>

      <div className="trust-layout">
        <article className="trust-card">
          <header><div><span className="eyebrow">INSTALLABLE FIELD TOOL</span><h3>Offline-capable application shell</h3></div><Download size={22} /></header>
          <div className={`install-state ${shellState.tone}`}><Info size={17} /><span><b>{shellState.label}</b><small>{shellState.copy}</small></span></div>
          {install.shellProgress.error && <p className="install-error" role="alert">{install.shellProgress.error}</p>}
          {['incomplete', 'unavailable'].includes(install.shell) && <button type="button" className="secondary-action fit" onClick={install.downloadOfflinePack} disabled={!online || !install.canDownload}><Download size={16} /> Download & verify offline OCR pack</button>}
          {install.installed ? <div className="install-state good"><Check size={17} /> Running as an installed app</div>
            : install.available ? <button type="button" className="primary-action fit" onClick={install.prompt}><Download size={16} /> Install NiyamLens</button>
              : <div className="install-state"><Info size={17} /> Use your browser menu’s “Install app” option when supported.</div>}
        </article>

        <article className="trust-card">
          <header><div><span className="eyebrow">DATA BOUNDARIES</span><h3>What the prototype actually guarantees</h3></div><LockKeyhole size={22} /></header>
          <ul>
            <li><Check size={15} /><span>Original images are hashed before OCR preprocessing.</span></li>
            <li><Check size={15} /><span>Raw OCR alternatives remain separate from officer edits.</span></li>
            <li><Check size={15} /><span>Rule findings preserve reasons, supplied evidence and uncertainty.</span></li>
            <li><Info size={15} /><span>Local browser storage is not certified WORM storage and is not independently notarized.</span></li>
            <li><Info size={15} /><span>Signing out does not erase local evidence on a shared device.</span></li>
          </ul>
        </article>
      </div>

      <article className="judge-path">
        <div><span className="eyebrow">60-SECOND VERIFICATION PATH</span><h3>Let a judge try to falsify it.</h3><p>Use a package the team has never seen, run one real capture, inspect the highlighted source, then open the rule reasoning and sealed evidence packet.</p></div>
        <div><button type="button" onClick={() => onNavigate('challenge')}>1 · Start blind challenge</button><button type="button" onClick={() => onNavigate('inspect')}>2 · Inspect a package</button><button type="button" onClick={() => onNavigate('rules')}>3 · Verify rule sources</button></div>
      </article>
    </section>
  )
}
