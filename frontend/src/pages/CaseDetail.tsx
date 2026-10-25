import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRightLeft, Bot, CheckCheck, ChevronDown, Download, FileText, GitMerge, Link2, Lock, MessageSquarePlus, Paperclip, ShieldAlert, ShieldCheck, Siren, Sparkles, TrendingUp, Unlink, Upload, UserCheck, UserPlus, Users, Zap } from 'lucide-react'
import { api, download, post, useApi, useRole } from '../api'
import { BureauBadge, Card, Countdown, Drawer, EmptyState, ErrorBox, Loading, SlaChip, StatusChip, cx, dueText, fmtDate, fmtTs } from '../ui'

const ICONS: any = {
  DOC_ADDED: Paperclip, RECEIVED: FileText, ASSIGNED: UserCheck, REMARK: FileText, TRANSFER: ArrowRightLeft, ESCALATE: TrendingUp,
  AUTO_ESCALATE: Bot, DISPOSE: CheckCheck, LINKED: GitMerge, COORDINATION: Users, LINKED_MANUAL: Link2, UNLINKED: Unlink,
}
const TONE: any = {
  TRANSFER: 'bg-sky-50 text-sky-700 ring-sky-200', ESCALATE: 'bg-orange-50 text-orange-700 ring-orange-200', AUTO_ESCALATE: 'bg-orange-50 text-orange-700 ring-orange-200',
  DISPOSE: 'bg-emerald-50 text-emerald-700 ring-emerald-200', LINKED: 'bg-indigo-50 text-indigo-700 ring-indigo-200', COORDINATION: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  LINKED_MANUAL: 'bg-indigo-50 text-indigo-700 ring-indigo-200', UNLINKED: 'bg-slate-100 text-slate-600 ring-slate-200',
}
const LABEL: any = {
  RECEIVED: 'Complaint received', ASSIGNED: 'Assigned to an officer', REMARK: 'Note added', TRANSFER: 'Sent to another Bureau', ESCALATE: 'Escalated',
  AUTO_ESCALATE: 'Escalated automatically', DISPOSE: 'Case closed', LINKED: 'Linked with related cases', COORDINATION: 'Coordination decision',
  LINKED_MANUAL: 'Linked by an officer', UNLINKED: 'Taken out of a room', DOC_ADDED: 'Document added', INSTITUTION_MATCHED: 'Institution matched',
  OVERLAP_CONFIRMED: 'Overlap confirmed', OVERLAP_REJECTED: 'Overlap ruled out', OVERLAP_DEFERRED: 'Overlap review postponed',
}

const ACTIONS: { k: string; label: string; sub: string; icon: any; title: string; confirm: string }[] = [
  { k: 'remark', label: 'Add a note', sub: 'Record what you found or did', icon: MessageSquarePlus, title: 'Add a note', confirm: 'Save note' },
  { k: 'assign', label: 'Assign an officer', sub: 'Hand it to a colleague', icon: UserPlus, title: 'Assign an officer', confirm: 'Assign' },
  { k: 'transfer', label: 'Send to another Bureau', sub: 'Move it to the right desk', icon: ArrowRightLeft, title: 'Send to another Bureau', confirm: 'Send the case' },
  { k: 'escalate', label: 'Escalate', sub: 'Ask a senior officer to step in', icon: TrendingUp, title: 'Escalate this case', confirm: 'Escalate' },
  { k: 'dispose', label: 'Close the case', sub: 'Record how it was resolved', icon: CheckCheck, title: 'Close this case', confirm: 'Close the case' },
]

function Fact({ label, children }: any) {
  return <div><dt className="eyebrow">{label}</dt><dd className="mt-1 text-[14px] text-slate-800">{children || '—'}</dd></div>
}

export default function CaseDetail() {
  const caseId = useParams()['*'] as string
  const me = useRole()
  return <CaseContent key={JSON.stringify([caseId, me.role, me.region])} caseId={caseId} />
}

function CaseContent({ caseId }: { caseId: string }) {
  const enc = encodeURIComponent(caseId)
  const pending = useRef(false)
  const activeView = useRef(true)
  const [busy, setBusy] = useState(false)
  useEffect(() => { activeView.current = true; return () => { activeView.current = false } }, [])
  const { data: c, error, loading } = useApi<any>(`/cases/${enc}`)
  const { data: h } = useApi<any>(`/cases/${enc}/history`)
  const { data: clock } = useApi<any>('/clock')
  const { data: officers } = useApi<any>('/meta/officers', false)
  const { data: meta } = useApi<any>('/meta', false)
  const { data: allOv } = useApi<any>(c?.overlap ? '/overlaps?status=all' : null)
  const [ver, setVer] = useState<any>(null)
  const { data: docs, reload: reloadDocs } = useApi<any>(`/cases/${enc}/documents`)
  const [uploadErr, setUploadErr] = useState('')
  const [act, setAct] = useState<string | null>(null)
  const [form, setForm] = useState<any>({})
  const [err, setErr] = useState('')
  const [ack, setAck] = useState(false)
  const [audit, setAudit] = useState(false)
  const [how, setHow] = useState(false)
  const me = useRole()
  const [linking, setLinking] = useState(false)
  const [linkFind, setLinkFind] = useState('')
  const [linkTarget, setLinkTarget] = useState('')
  const [linkWhy, setLinkWhy] = useState('')
  const [linkErr, setLinkErr] = useState('')
  const { data: pool } = useApi<any>(linking && c ? `/cases?institution_id=${encodeURIComponent(c.institution.aicte_id)}&page_size=200` : null, false)
  if (loading && !c) return <Loading />
  if (error && !c) return <ErrorBox msg={error} />
  if (!c || c.case_id !== caseId || (me.role === 'REGIONAL' && (!me.region || c.institution.region !== me.region))) return <Loading />
  const ov = c.overlap
  const active = ov && ov.status !== 'RESOLVED' && ov.status !== 'DISMISSED'
  const cluster = (allOv?.items || []).find((x: any) => x.cluster_id === ov?.cluster_id)
  const others: any[] = (cluster?.cases || []).filter((x: any) => x.case_id !== c.case_id)
  const resolutionLabel = c.resolution.method === 'ID' ? 'matched by its AICTE ID' : `matched by name (${Math.round(c.resolution.confidence)}% sure)`
  const canLink = me.role !== 'REGIONAL'

  const linkNeedle = linkFind.trim().toLowerCase()
  const linkable = (pool?.items || []).filter((x: any) => x.case_id !== c.case_id &&
    (!linkNeedle || `${x.case_id} ${x.category} ${x.bureau}`.toLowerCase().includes(linkNeedle)))
  async function submitLink() {
    if (pending.current) return
    pending.current = true; setBusy(true)
    setLinkErr('')
    try {
      await post('/links', { case_a: c.case_id, case_b: linkTarget, rationale: linkWhy })
      setLinking(false); setLinkTarget(''); setLinkWhy(''); setLinkFind('')
    } catch (e: any) { setLinkErr(e.message) }
    finally { pending.current = false; setBusy(false) }
  }
  async function verify() { setVer(await api(`/audit/verify?case_id=${enc}`)) }
  const allowed: string[] = c.allowed_actions || []
  const needsAck = !!c.guard && !!act && c.guard.applies_to.includes(act) && (c.guard.level === 'ack' || (c.guard.level === 'block' && me.role === 'SENIOR'))
  const current = ACTIONS.find((a) => a.k === act)
  function onFile(e: any) {
    const f: File = e.target.files?.[0]
    e.target.value = ''
    if (!f || pending.current) return
    setUploadErr('')
    if (f.size > 2 * 1024 * 1024) { setUploadErr('That file is larger than 2 MB.'); return }
    pending.current = true; setBusy(true)
    const rd = new FileReader()
    rd.onload = async () => {
      if (!activeView.current) return
      const b64 = String(rd.result).split(',')[1] || ''
      try { await post(`/cases/${enc}/documents`, { filename: f.name, content_base64: b64 }); reloadDocs() } catch (er: any) { setUploadErr(er.message) }
      finally { pending.current = false; if (activeView.current) setBusy(false) }
    }
    rd.onerror = () => { pending.current = false; if (activeView.current) { setBusy(false); setUploadErr('The file could not be read. Please try again.') } }
    rd.readAsDataURL(f)
  }
  async function submit() {
    if (pending.current || !act) return
    pending.current = true; setBusy(true)
    setErr('')
    try {
      await post(`/cases/${enc}/actions`, { type: act, ...form, acknowledge_overlap: ack })
      setAct(null); setForm({})
    } catch (e: any) { setErr(e.message) }
    finally { pending.current = false; setBusy(false) }
  }

  return (
    <div className="mx-auto max-w-[1240px]">
      <Link to="/cases" className="rise mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-slate-500 hover:text-slate-900">← All cases</Link>

      {/* ---------- cover ---------- */}
      <header className="rise mb-6 grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="case-id text-[15px] text-navy-2">{c.case_id}</span>
            <StatusChip status={c.status} /><BureauBadge code={c.bureau} full />
            {c.escalation_level > 0 && <span className="rounded-[4px] border border-orange-200 bg-orange-50 px-1.5 py-px text-[11px] font-bold uppercase tracking-wide text-orange-700">Escalated · level {c.escalation_level}</span>}
          </div>
          <h1 className="font-display mt-2 text-[1.875rem] font-semibold leading-[1.12] text-slate-900 md:text-[2.25rem]">
            <Link to={`/institutions/${c.institution.aicte_id}`} className="hover:underline decoration-slate-300 underline-offset-4">{c.institution.name}</Link>
          </h1>
          <p className="mt-1.5 text-[15px] text-slate-600">{c.category} · {c.institution.city}, {c.institution.region} region · received {fmtDate(c.received_on)} via {c.source}</p>
        </div>
        <div data-theme="dark" className="mesh rounded-2xl p-4 lg:min-w-[280px]">
          <div className="eyebrow">Time left to respond</div>
          <div className="mt-1.5 flex items-baseline gap-3">
            {clock ? <Countdown dueDate={c.expected_disposal} serverNow={clock.now} closed={c.sla.state === 'CLOSED'} /> : <span>—</span>}
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[12.5px] text-slate-500">
            <span>{c.sla.state === 'CLOSED' ? 'Closed' : `Due ${fmtDate(c.expected_disposal)} · ${c.sla.days}-day limit`}</span>
            <SlaChip sla={c.sla} />
          </div>
        </div>
      </header>

      {/* ---------- notices ---------- */}
      <div className="mb-6 space-y-3 empty:hidden">
        {active && (
          <div className="rise rise-2 overflow-hidden rounded-xl border border-red-200 bg-red-50">
            <div className="flex flex-wrap items-center gap-4 p-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-red-100 text-red-600 pulse-red"><Siren size={21} /></div>
              <div className="min-w-0 flex-1 basis-64">
                <div className="font-display text-[1.1875rem] font-semibold text-red-800">Potential Overlapping Cases — Coordination Required</div>
                <div className="text-[14px] text-red-800/90">{ov.other_bureaus.join(' and ')} {ov.other_bureaus.length > 1 ? 'are' : 'is'} also dealing with this institution. Talk to them before you act so the work is not duplicated.</div>
              </div>
              <Link to={`/overlaps?open=${ov.cluster_id}`} className="btn btn-danger">See why and coordinate</Link>
            </div>
          </div>)}
        {c.room && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-[14px] text-indigo-900">
            Part of coordination room <Link className="case-id underline" to={`/rooms/${c.room.id}`}>{c.room.id}</Link>. {c.room.lead_bureau === c.bureau ? <>Your Bureau (<b>{c.room.lead_bureau}</b>) leads.</> : <><b>{c.room.lead_bureau}</b> leads, and this Bureau follows its decisions.</>} <span className="text-indigo-700">({c.room.status === 'OPEN' ? 'still open' : c.room.status.toLowerCase()})</span></div>)}
        {c.guard && c.guard.level === 'block' && (
          <div className="flex items-start gap-3 rounded-xl border border-indigo-300 bg-indigo-100/60 px-4 py-3 text-[14px] text-indigo-900">
            <Lock size={17} className="mt-0.5 shrink-0" /><span><b>Some actions are paused.</b> {c.guard.message} You can still add notes, assign an officer and attach documents.</span></div>)}
        {c.guard && c.guard.level === 'ack' && c.guard.code === 'LEAD_WITH_OPEN_FOLLOWERS' && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[14px] text-amber-900">
            <Siren size={17} className="mt-0.5 shrink-0" /><span>{c.guard.message}</span></div>)}
      </div>

      {/* ---------- what to do ---------- */}
      <section className="rise rise-1 mb-6 rounded-xl border border-line bg-sheet shadow-sm" aria-label="Actions">
        {c.next_action && c.status !== 'Disposed' && (
          <div className="flex items-start gap-3 rounded-t-xl border-b border-line bg-amber-50/70 px-5 py-3">
            <Sparkles size={17} className="mt-0.5 shrink-0 text-saffron" />
            <p className="text-[14.5px] text-slate-800"><span className="font-semibold">Next step:</span> {c.next_action}</p>
          </div>)}
        <div className="p-5">
          <div className="eyebrow mb-3">What would you like to do?</div>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
            {ACTIONS.map((a) => {
              const ok = allowed.includes(a.k)
              return (
                <button key={a.k} disabled={busy || !ok} onClick={() => { setAct(a.k); setForm({}); setErr(''); setAck(false) }}
                  title={ok ? undefined : c.status === 'Disposed' ? 'This case is closed' : 'Your role cannot do this on this case'}
                  className={cx('flex items-start gap-3 rounded-lg border p-3 text-left transition',
                    ok ? 'border-line bg-sheet hover:-translate-y-0.5 hover:border-navy-2/50 hover:shadow-md' : 'cursor-not-allowed border-line/70 bg-slate-100/50 opacity-55')}>
                  <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-lg', ok ? 'bg-navy text-white' : 'bg-slate-200 text-slate-400')}><a.icon size={17} /></span>
                  <span><span className="block text-[14px] font-semibold leading-tight text-slate-900">{a.label}</span><span className="mt-0.5 block text-[12px] leading-snug text-slate-500">{a.sub}</span></span>
                </button>)
            })}
          </div>
          {allowed.length === 0 && (
            <p className="mt-3 flex items-center gap-2 text-[13px] text-slate-500"><Lock size={14} />
              {c.status === 'Disposed' ? 'This case is closed, so nothing more can be done.' : 'You can read this case but not act on it. Only the Bureau that holds it can.'}</p>)}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ---------- story ---------- */}
        <Card className="rise rise-2 lg:col-span-2" title="What has happened so far" subtitle="Newest first. Every step is recorded and cannot be quietly changed."
          right={<button onClick={verify} className="btn btn-ghost btn-sm"><ShieldCheck size={14} /> Check the record</button>}>
          {ver && (
            <div className={cx('mb-4 flex items-center gap-2 rounded-lg p-3 text-sm', ver.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800')}>
              {ver.ok ? <ShieldCheck size={17} /> : <ShieldAlert size={17} />}
              {ver.ok ? `The record is intact. ${ver.checked} entries were checked and none has been altered.` : `A change was detected at entry #${ver.first_break.seq}: ${ver.first_break.reason}.`}
            </div>)}
          <ol className="relative space-y-5 border-l border-line pl-7">
            {(h?.items || []).slice().reverse().map((e: any) => {
              const Icon = ICONS[e.action_type] || FileText
              return (
                <li key={e.seq} className="relative">
                  <span className={cx('absolute -left-[41px] grid h-8 w-8 place-items-center rounded-full ring-1 ring-inset ring-offset-4 ring-offset-sheet', TONE[e.action_type] || 'bg-slate-100 text-slate-600 ring-slate-200')}><Icon size={15} /></span>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-[15px] font-semibold text-slate-900">{LABEL[e.action_type] || e.action_type.replace(/_/g, ' ').toLowerCase()}</span>
                    {e.from_bureau && e.to_bureau && e.from_bureau !== e.to_bureau && <span className="flex items-center gap-1.5 text-xs"><BureauBadge code={e.from_bureau} /> → <BureauBadge code={e.to_bureau} /></span>}
                    <span className="text-[12.5px] text-slate-400">{fmtTs(e.ts)}</span>
                  </div>
                  <p className="mt-1 text-[14px] leading-relaxed text-slate-700">{e.remarks}</p>
                  {(e.documents || []).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {e.documents.map((d: any) => (
                        <button key={d.id} onClick={() => download(`/documents/${d.id}/download`, d.filename)}
                          className="flex items-center gap-1 rounded-md border border-line bg-sheet px-2 py-0.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50"><Paperclip size={11} />{d.filename}</button>))}
                    </div>)}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-[12px] text-slate-400">
                    <span className="flex items-center gap-1">{e.actor.name === 'System (SLA engine)' ? <Zap size={11} /> : <UserCheck size={11} />}{e.actor.name} · {e.actor.bureau}</span>
                    {audit && <span className="font-mono text-[11px]" title={`previous ${e.prev_hash}\nthis entry ${e.hash}`}>fingerprint {e.hash.slice(0, 12)}</span>}
                  </div>
                </li>)
            })}
          </ol>
          <button onClick={() => setAudit((v) => !v)} className="mt-5 text-[12.5px] font-semibold text-slate-500 hover:text-slate-900">{audit ? 'Hide' : 'Show'} technical audit details</button>
        </Card>

        {/* ---------- sidebar ---------- */}
        <div className="space-y-6">
          <Card className="rise rise-3" title="The complaint">
            <blockquote className="font-display border-l-2 border-saffron pl-4 text-[1.0625rem] leading-relaxed text-slate-800">{c.description}</blockquote>
            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
              <Fact label="Category">{c.category}</Fact>
              <Fact label="Seriousness"><span className="num">{c.severity} of 5</span></Fact>
              <Fact label="Looked after by">{c.assigned_officer.name}<div className="text-xs text-slate-400">{c.assigned_officer.designation}</div></Fact>
              <Fact label="Reference">{c.reference_no}</Fact>
              <Fact label="Last action">{c.last_action}<div className="text-xs text-slate-400">{fmtTs(c.last_action_at)}</div></Fact>
              <Fact label="Source">{c.source}</Fact>
              {c.outcome && <div className="col-span-2"><Fact label="Outcome">{c.outcome}</Fact></div>}
            </dl>
          </Card>

          <Card className="rise rise-3" title="Related cases" subtitle={active ? 'Other Bureaus are dealing with this institution too.' : undefined}
            right={canLink && <button onClick={() => { setLinking(true); setLinkErr('') }} className="btn btn-ghost btn-sm"><Link2 size={14} /> Link a case</button>}>
            {others.length > 0 ? (
              <ul className="-mx-1 divide-y divide-line">
                {others.map((o: any) => (
                  <li key={o.case_id} className="px-1 py-3">
                    <div className="flex flex-wrap items-center gap-2"><BureauBadge code={o.bureau} /><Link to={`/cases/${o.case_id}`} className="case-id text-navy-2 hover:underline">{o.case_id}</Link><StatusChip status={o.status} /></div>
                    <div className="mt-1 text-[13px] text-slate-600">{o.assigned_officer.name} · {o.category}</div>
                    <div className="text-[12.5px] text-slate-400">Last: {o.last_action || '—'}</div>
                  </li>))}
              </ul>
            ) : active ? <p className="text-sm text-slate-500">Loading the other cases…</p>
              : <p className="text-sm text-slate-500">No other case is linked to this one. If you know of one the system missed, link it.</p>}
            {active && <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
              <Link to={`/overlaps?open=${ov.cluster_id}`} className="btn btn-ghost btn-sm">Why were they flagged?</Link>
              {c.room && <Link to={`/rooms/${c.room.id}`} className="btn btn-primary btn-sm">Open the room</Link>}
            </div>}
          </Card>

          <Card className="rise rise-4" title="Documents"
            right={allowed.includes('remark') ? (
              <label className="btn btn-ghost btn-sm cursor-pointer"><Upload size={13} /> Add a file<input type="file" className="hidden" disabled={busy} onChange={onFile} /></label>) : undefined}>
            {uploadErr && <div className="mb-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{uploadErr}</div>}
            <ul className="space-y-2">
              {(docs?.items || []).map((d: any) => (
                <li key={d.id} className="flex items-center gap-3 rounded-lg border border-line bg-sheet p-2.5 text-sm">
                  <Paperclip size={15} className="shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1"><div className="truncate font-medium text-slate-800">{d.filename}</div>
                    <div className="text-[11.5px] text-slate-400">{(d.size / 1024).toFixed(1)} KB · {d.uploaded_by} · {fmtTs(d.uploaded_at)}</div></div>
                  <span title={`SHA-256 ${d.sha256}`} className={cx('rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide', d.verified ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>{d.verified ? 'Unchanged' : 'Altered'}</span>
                  <button onClick={() => download(`/documents/${d.id}/download`, d.filename)} aria-label={`Download ${d.filename}`} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><Download size={15} /></button>
                </li>))}
              {(docs?.items || []).length === 0 && <li className="text-sm text-slate-400">No documents attached.</li>}
            </ul>
          </Card>

          <section className="rounded-xl border border-dashed border-slate-300">
            <button onClick={() => setHow((v) => !v)} aria-expanded={how} className="flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] font-semibold text-slate-600 hover:text-slate-900">
              <span className="flex-1">How was the institution identified?</span><ChevronDown size={15} className={cx('transition', how && 'rotate-180')} /></button>
            {how && (
              <div className="space-y-2 border-t border-dashed border-slate-300 px-4 py-3 text-[13.5px]">
                <div className="rounded-lg bg-slate-100 p-3"><div className="eyebrow">Written in the complaint as</div>
                  <div className="mt-0.5 font-medium text-slate-800">“{c.submitted_institution_name}”</div>
                  <div className="text-xs text-slate-500">{c.submitted_aicte_id ? `AICTE ID given: ${c.submitted_aicte_id}` : 'No AICTE ID was given'}</div></div>
                <p className="text-emerald-800">Matched to <b>{c.institution.aicte_id}</b>, {resolutionLabel}.</p>
              </div>)}
          </section>
        </div>
      </div>

      {/* ---------- action drawer ---------- */}
      <Drawer open={!!act} onClose={() => setAct(null)} width={480}
        title={<div><div className="case-id text-slate-400">{c.case_id}</div><div className="font-display text-[1.5rem] font-semibold text-slate-900">{current?.title}</div></div>}>
        <div className="space-y-5">
          {act === 'transfer' && (
            <label className="block"><span className="mb-1.5 block text-sm font-semibold">Which Bureau should take it?</span>
              <select value={form.to_bureau || ''} onChange={(e) => setForm({ ...form, to_bureau: e.target.value })} className="field">
                <option value="">Choose a Bureau or Cell…</option>
                {(meta?.bureaus || []).filter((b: any) => b.code !== c.bureau).map((b: any) => <option key={b.code} value={b.code}>{b.name} ({b.code})</option>)}
              </select></label>)}
          {act === 'assign' && (
            <label className="block"><span className="mb-1.5 block text-sm font-semibold">Who in {c.bureau} should look after it?</span>
              <select value={form.officer_id || ''} onChange={(e) => setForm({ ...form, officer_id: e.target.value })} className="field">
                <option value="">Choose an officer…</option>
                {(officers?.items || []).filter((o: any) => o.bureau_code === c.bureau).map((o: any) => <option key={o.id} value={o.id}>{o.name} — {o.designation}</option>)}
              </select></label>)}
          <label className="block"><span className="mb-1.5 block text-sm font-semibold">
            {act === 'dispose' ? 'How was it resolved?' : act === 'remark' ? 'Your note' : 'Why? (optional, but helps the next person)'}
            {(act === 'dispose' || act === 'remark') && <span className="ml-1.5 text-xs font-medium text-red-600">Required</span>}</span>
            <textarea rows={4} value={form.remarks || ''} onChange={(e) => setForm({ ...form, remarks: e.target.value })} className="field" placeholder="This is added to the case history" /></label>
          {act !== 'dispose' && act !== 'remark' && (
            <label className="block"><span className="mb-1.5 block text-sm font-semibold">What should happen next? <span className="font-normal text-slate-400">(optional)</span></span>
              <input value={form.next_action || ''} onChange={(e) => setForm({ ...form, next_action: e.target.value })} className="field" /></label>)}
          {act === 'transfer' && c.transfer_count >= 2 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">This case has already moved {c.transfer_count} times. Another transfer will raise a “passed around” alert.</div>}
          {needsAck && (
            <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              <div className="flex items-center gap-2 font-display text-[1.0625rem] font-semibold"><Siren size={17} /> Coordinate before you act</div>
              <p className="mt-1.5">{c.guard.message}</p>
              <Link to={c.guard.room_id ? `/rooms/${c.guard.room_id}` : `/overlaps?open=${c.guard.cluster_id}`} className="mt-2 inline-block font-semibold underline">
                {c.guard.room_id ? `Open coordination room ${c.guard.room_id}` : 'Review the overlap and open a coordination room'}</Link>
              <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-[13.5px]">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 h-4 w-4" />
                <span>I have spoken to {(c.guard.other_bureaus || []).join(', ') || 'the other Bureaus'} and want to go ahead. This is written in the case history.</span>
              </label>
            </div>)}
          {err && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{err}</div>}
          <button onClick={submit} disabled={busy || (needsAck && !ack)} className="btn btn-primary w-full !py-3">{busy ? 'Saving…' : current?.confirm}</button>
          <p className="text-center text-[12px] text-slate-400">Saved with the time and your Bureau, and added to the permanent record.</p>
        </div>
      </Drawer>

      {/* ---------- link drawer ---------- */}
      <Drawer open={linking} onClose={() => setLinking(false)} width={500}
        title={<div><div className="case-id text-slate-400">{c.case_id}</div><div className="font-display text-[1.5rem] font-semibold text-slate-900">Link to another case</div></div>}>
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-slate-600">Use this when you know two complaints belong together but the system did not connect them. Only cases at {c.institution.name} can be linked. The link is written to both cases and starts a coordination issue.</p>
          <input value={linkFind} onChange={(e) => setLinkFind(e.target.value)} placeholder="Search by case number, category or Bureau…" className="field" />
          <ul className="max-h-72 divide-y divide-line overflow-auto rounded-lg border border-line bg-sheet">
            {linkable.length === 0 && <li className="p-4 text-sm text-slate-400">{pool ? 'No other cases of this institution match.' : 'Loading…'}</li>}
            {linkable.map((x: any) => {
              const already = !!c.overlap && x.overlap?.cluster_id === c.overlap.cluster_id
              return (
                <li key={x.case_id}>
                  <label className={cx('flex cursor-pointer items-center gap-3 px-3.5 py-2.5 text-sm hover:bg-slate-50', linkTarget === x.case_id && 'bg-indigo-50')}>
                    <input type="radio" name="link-target" checked={linkTarget === x.case_id} onChange={() => setLinkTarget(x.case_id)} />
                    <BureauBadge code={x.bureau} />
                    <span className="case-id text-navy-2">{x.case_id}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{x.category}</span>
                    {already && <span className="rounded-[4px] bg-indigo-100 px-1.5 text-[10px] font-bold uppercase text-indigo-700">Linked</span>}
                    <StatusChip status={x.status} />
                  </label>
                </li>)
            })}
          </ul>
          <label className="block"><span className="mb-1.5 block text-sm font-semibold">Why do these belong together? <span className="ml-1 text-xs font-medium text-red-600">Required</span></span>
            <textarea rows={3} value={linkWhy} onChange={(e) => setLinkWhy(e.target.value)} placeholder="This is written to both cases" className="field" /></label>
          {linkErr && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{linkErr}</div>}
          <button onClick={submitLink} disabled={busy || !linkTarget || !linkWhy.trim()} className="btn btn-primary w-full !py-3">{busy ? 'Saving…' : 'Link the cases'}</button>
        </div>
      </Drawer>
    </div>
  )
}
