import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRightLeft, Download, Paperclip, Upload, BadgeCheck, Bot, CheckCheck, FileText, GitMerge, Hash, Lock, MessageSquarePlus, ShieldAlert, ShieldCheck, TrendingUp, UserCheck, UserPlus, Users, Zap, Siren } from 'lucide-react'
import { api, download, post, useApi, useRole } from '../api'
import { BureauBadge, Card, Countdown, Drawer, ErrorBox, Loading, SlaChip, StatusChip, cx, fmtDate, fmtTs } from '../ui'

const ICONS: any = {
  DOC_ADDED: Paperclip, RECEIVED: FileText, ASSIGNED: UserCheck, REMARK: FileText, TRANSFER: ArrowRightLeft, ESCALATE: TrendingUp,
  AUTO_ESCALATE: Bot, DISPOSE: CheckCheck, LINKED: GitMerge, COORDINATION: Users,
}
const TONE: any = {
  TRANSFER: 'bg-sky-100 text-sky-700', ESCALATE: 'bg-orange-100 text-orange-700', AUTO_ESCALATE: 'bg-orange-100 text-orange-700',
  DISPOSE: 'bg-emerald-100 text-emerald-700', LINKED: 'bg-red-100 text-red-700', COORDINATION: 'bg-red-100 text-red-700',
}

function Field({ label, children }: any) {
  return <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt><dd className="mt-0.5 text-sm text-slate-800">{children || '—'}</dd></div>
}

export default function CaseDetail() {
  const caseId = useParams()['*'] as string
  const enc = encodeURIComponent(caseId)
  const { data: c, error, loading } = useApi<any>(`/cases/${enc}`)
  const { data: h } = useApi<any>(`/cases/${enc}/history`)
  const { data: clock } = useApi<any>('/clock')
  const { data: officers } = useApi<any>('/meta/officers', false)
  const { data: meta } = useApi<any>('/meta', false)
  const [ver, setVer] = useState<any>(null)
  const { data: docs, reload: reloadDocs } = useApi<any>(`/cases/${enc}/documents`)
  const [uploadErr, setUploadErr] = useState('')
  const [act, setAct] = useState<string | null>(null)
  const [form, setForm] = useState<any>({})
  const [err, setErr] = useState('')
  const [ack, setAck] = useState(false)
  const me = useRole()
  if (loading && !c) return <Loading />
  if (error && !c) return <ErrorBox msg={error} />
  const ov = c.overlap
  const active = ov && ov.status !== 'RESOLVED' && ov.status !== 'DISMISSED'
  const resolutionLabel = c.resolution.method === 'ID' ? 'matched by AICTE ID' : `matched by name (${Math.round(c.resolution.confidence)}% confidence)`

  async function verify() { setVer(await api(`/audit/verify?case_id=${enc}`)) }
  const allowed: string[] = c.allowed_actions || []
  const needsAck = !!c.guard && !!act && c.guard.applies_to.includes(act) && (c.guard.level === 'ack' || (c.guard.level === 'block' && me.role === 'SENIOR'))
  const ACTIONS: any[] = [
    { k: 'remark', label: 'Add remark', icon: MessageSquarePlus, tone: 'border-slate-200 text-slate-700 hover:bg-slate-50' },
    { k: 'assign', label: 'Assign officer', icon: UserPlus, tone: 'border-slate-200 text-slate-700 hover:bg-slate-50' },
    { k: 'transfer', label: 'Transfer', icon: ArrowRightLeft, tone: 'border-sky-200 text-sky-700 hover:bg-sky-50' },
    { k: 'escalate', label: 'Escalate', icon: TrendingUp, tone: 'border-orange-200 text-orange-700 hover:bg-orange-50' },
    { k: 'dispose', label: 'Dispose', icon: CheckCheck, tone: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50' },
  ]
  function onFile(e: any) {
    const f: File = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setUploadErr('')
    if (f.size > 2 * 1024 * 1024) { setUploadErr('File is larger than 2 MB'); return }
    const rd = new FileReader()
    rd.onload = async () => {
      const b64 = String(rd.result).split(',')[1] || ''
      try { await post(`/cases/${enc}/documents`, { filename: f.name, content_base64: b64 }); reloadDocs() } catch (er: any) { setUploadErr(er.message) }
    }
    rd.readAsDataURL(f)
  }
  async function submit() {
    setErr('')
    try {
      await post(`/cases/${enc}/actions`, { type: act, ...form, acknowledge_overlap: ack })
      setAct(null); setForm({})
    } catch (e: any) { setErr(e.message) }
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1300px] space-y-5">
      <Link to="/cases" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={15} /> All cases</Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="break-words text-2xl font-bold tracking-tight">{c.case_id}</h1>
            <StatusChip status={c.status} /><BureauBadge code={c.bureau} />
            {c.escalation_level > 0 && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-700">ESCALATED L{c.escalation_level}</span>}
          </div>
          <Link to={`/institutions/${c.institution.aicte_id}`} className="mt-1 block break-words text-slate-600 hover:underline">{c.institution.name}</Link>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-4 rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200/70 sm:w-auto sm:flex-nowrap">
          <div><div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Prescribed timeline</div>
            <div className="num text-sm text-slate-600">
  {c.sla.days} {c.sla.use_working_days ? 'working days' : 'calendar days'} · due {fmtDate(c.expected_disposal)}
</div></div>
          <SlaChip sla={c.sla} />
          {clock && <div className="min-w-0 border-l border-slate-200 pl-4"><Countdown dueDate={c.expected_disposal} serverNow={clock.now} closed={c.sla.state === 'CLOSED'} /></div>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200/70">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Actions</span>
        {ACTIONS.map((a) => {
          const ok = allowed.includes(a.k)
          return (
            <button key={a.k} disabled={!ok} onClick={() => { setAct(a.k); setForm({}); setErr(''); setAck(false) }}
              className={cx('flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition', ok ? a.tone : 'cursor-not-allowed border-slate-100 text-slate-300')}>
              <a.icon size={15} /> {a.label}</button>)
        })}
        {allowed.length === 0 && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-400"><Lock size={13} /> {c.status === 'Disposed' ? 'Case is closed' : 'Read-only for your role'}</span>)}
      </div>

      {active && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="rounded-full bg-red-100 p-2 text-red-600 pulse-red"><Siren size={20} /></div>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-red-700">Potential Overlapping Cases — Coordination Required</div>
            <div className="text-sm text-red-700/90">The same institution has related complaints with {ov.other_bureaus.join(', ')}. Avoid duplicate action — coordinate before proceeding.</div>
          </div>
          <Link to={`/overlaps?open=${ov.cluster_id}`} className="rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-red-700">Why flagged &amp; coordinate</Link>
        </div>)}
      {c.room && <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-800">
        Linked in <Link className="font-semibold underline" to={`/rooms/${c.room.id}`}>{c.room.id}</Link> · lead Bureau <b>{c.room.lead_bureau}</b>
        {c.room.lead_bureau !== c.bureau && ` — this Bureau follows ${c.room.lead_bureau}'s lead`} · {c.room.status}</div>}
      {c.guard && c.guard.level === 'block' && (
        <div className="flex items-start gap-3 rounded-xl border border-indigo-300 bg-indigo-100/60 p-3.5 text-sm text-indigo-900">
          <Lock size={17} className="mt-0.5 shrink-0" /><span><b>Actions restricted.</b> {c.guard.message} You can still add remarks, assign an officer and attach documents.</span></div>)}
      {c.guard && c.guard.level === 'ack' && c.guard.code === 'LEAD_WITH_OPEN_FOLLOWERS' && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-900">
          <Siren size={17} className="mt-0.5 shrink-0" /><span>{c.guard.message}</span></div>)}

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card title="Case details">
            <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
              <Field label="Category">{c.category}</Field>
              <Field label="Severity"><span className="num">{c.severity} / 5</span></Field>
              <Field label="Date of receipt">{fmtDate(c.received_on)}</Field>
              <Field label="Source">{c.source}</Field>
              <Field label="Assigned officer">{c.assigned_officer.name}<div className="text-xs text-slate-400">{c.assigned_officer.designation}</div></Field>
              <Field label="Reference no.">{c.reference_no}</Field>
              <Field label="Last action">{c.last_action}<div className="text-xs text-slate-400">{fmtTs(c.last_action_at)}</div></Field>
              <Field label="Next action required">{c.next_action}</Field>
              {c.outcome && <div className="sm:col-span-2"><Field label="Outcome">{c.outcome}</Field></div>}
            </dl>
            <div className="mt-4 border-t border-slate-100 pt-3"><dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Complaint</dt>
              <p className="mt-1 text-sm leading-relaxed text-slate-700">{c.description}</p></div>
          </Card>

          <Card title="Institution matching">
            <div className="space-y-2 text-sm">
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-[11px] uppercase tracking-wider text-slate-400">Submitted as</div>
                <div className="font-medium text-slate-800">“{c.submitted_institution_name}”</div>
                <div className="text-xs text-slate-500">{c.submitted_aicte_id ? `AICTE ID quoted: ${c.submitted_aicte_id}` : 'No AICTE ID on the complaint'}</div></div>
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-emerald-700"><BadgeCheck size={16} /> Resolved to <b>{c.institution.aicte_id}</b> — {resolutionLabel}</div>
            </div>
          </Card>

          <Card title="Supporting documents"
            right={allowed.includes('remark') ? (
              <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                <Upload size={13} /> Add document<input type="file" className="hidden" onChange={onFile} /></label>) : undefined}>
            {uploadErr && <div className="mb-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{uploadErr}</div>}
            <ul className="space-y-2">
              {(docs?.items || []).map((d: any) => (
                <li key={d.id} className="flex min-w-0 flex-wrap items-center gap-2.5 rounded-lg bg-slate-50 p-2.5 text-sm sm:flex-nowrap">
                  <Paperclip size={15} className="shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1"><div className="truncate font-medium text-slate-800">{d.filename}</div>
                    <div className="text-[11px] text-slate-400">{(d.size / 1024).toFixed(1)} KB · {d.uploaded_by} · {fmtTs(d.uploaded_at)}</div></div>
                  <span title={`SHA-256 ${d.sha256}`} className={cx('rounded px-1.5 py-0.5 text-[10px] font-bold', d.verified ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>{d.verified ? 'HASH OK' : 'ALTERED'}</span>
                  <button onClick={() => download(`/documents/${d.id}/download`, d.filename)} className="rounded-md p-1.5 text-slate-500 hover:bg-white"><Download size={15} /></button>
                </li>))}
              {(docs?.items || []).length === 0 && <li className="text-sm text-slate-400">No documents attached.</li>}
            </ul>
          </Card>
        </div>

        <Card title="Action history & movement" className="min-w-0 lg:col-span-3"
          right={<button onClick={verify} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"><ShieldCheck size={14} /> Verify integrity</button>}>
          {ver && (
            <div className={cx('mb-3 flex items-center gap-2 rounded-lg p-2.5 text-sm', ver.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
              {ver.ok ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
              {ver.ok ? `Audit trail intact — ${ver.checked} records, hash chain verified.` : `Tampering detected at record #${ver.first_break.seq}: ${ver.first_break.reason}.`}
            </div>)}
          <ol className="relative min-w-0 space-y-4 border-l-2 border-slate-100 pl-6">
            {(h?.items || []).slice().reverse().map((e: any) => {
              const Icon = ICONS[e.action_type] || FileText
              return (
                <li key={e.seq} className="relative">
                  <span className={cx('absolute -left-[37px] grid h-7 w-7 place-items-center rounded-full ring-4 ring-white', TONE[e.action_type] || 'bg-slate-100 text-slate-600')}><Icon size={14} /></span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">{e.action_type.replace('_', ' ')}</span>
                    {e.from_bureau && e.to_bureau && e.from_bureau !== e.to_bureau && <span className="flex items-center gap-1 text-xs"><BureauBadge code={e.from_bureau} /> → <BureauBadge code={e.to_bureau} /></span>}
                    <span className="text-xs text-slate-400">{fmtTs(e.ts)}</span>
                  </div>
                  <p className="mt-0.5 break-words text-sm text-slate-600">{e.remarks}</p>
                  {(e.documents || []).length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {e.documents.map((d: any) => (
                        <button key={d.id} onClick={() => download(`/documents/${d.id}/download`, d.filename)}
                          className="flex max-w-full min-w-0 items-center gap-1 break-all rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200"><Paperclip size={11} />{d.filename}</button>))}
                    </div>)}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1">{e.actor.name === 'System (SLA engine)' ? <Zap size={11} /> : <UserCheck size={11} />}{e.actor.name} · {e.actor.bureau}</span>
                    <span className="flex items-center gap-1 font-mono" title={`prev ${e.prev_hash}\nhash ${e.hash}`}><Hash size={10} />{e.hash.slice(0, 10)}…</span>
                  </div>
                </li>)
            })}
          </ol>
        </Card>
      </div>
      <Drawer open={!!act} onClose={() => setAct(null)} width={460}
        title={<div><div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{c.case_id}</div>
          <div className="font-bold capitalize text-slate-900">{act === 'assign' ? 'Assign officer' : act === 'dispose' ? 'Dispose case' : act}</div></div>}>
        <div className="space-y-4">
          {act === 'transfer' && (
            <label className="block"><span className="mb-1 block text-sm font-medium">Transfer to</span>
              <select value={form.to_bureau || ''} onChange={(e) => setForm({ ...form, to_bureau: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="">Select Bureau / Cell…</option>
                {(meta?.bureaus || []).filter((b: any) => b.code !== c.bureau).map((b: any) => <option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}
              </select></label>)}
          {act === 'assign' && (
            <label className="block"><span className="mb-1 block text-sm font-medium">Officer ({c.bureau})</span>
              <select value={form.officer_id || ''} onChange={(e) => setForm({ ...form, officer_id: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="">Select officer…</option>
                {(officers?.items || []).filter((o: any) => o.bureau_code === c.bureau).map((o: any) => <option key={o.id} value={o.id}>{o.name} — {o.designation}</option>)}
              </select></label>)}
          <label className="block"><span className="mb-1 block text-sm font-medium">{act === 'dispose' ? 'Outcome / disposal remarks (required)' : 'Remarks'}{act === 'remark' ? ' (required)' : ''}</span>
            <textarea rows={4} value={form.remarks || ''} onChange={(e) => setForm({ ...form, remarks: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-navy-2" placeholder="Visible in the case history and written to the audit trail" /></label>
          {act !== 'dispose' && act !== 'remark' && (
            <label className="block"><span className="mb-1 block text-sm font-medium">Next action required (optional)</span>
              <input value={form.next_action || ''} onChange={(e) => setForm({ ...form, next_action: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>)}
          {act === 'transfer' && c.transfer_count >= 2 && <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">This case has already moved {c.transfer_count} times. A further transfer will raise a ping-pong alert.</div>}
          {err && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</div>}
          {needsAck && (
            <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-900">
              <div className="flex items-center gap-2 font-bold"><Siren size={16} /> Coordinate before acting</div>
              <p className="mt-1">{c.guard.message}</p>
              <Link to={c.guard.room_id ? `/rooms/${c.guard.room_id}` : `/overlaps?open=${c.guard.cluster_id}`} className="mt-2 inline-block font-semibold underline">
                {c.guard.room_id ? `Open Coordination Room ${c.guard.room_id}` : 'Review the overlap and open a Coordination Room'}</Link>
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-[13px]">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
                <span>I have checked with {(c.guard.other_bureaus || []).join(', ') || 'the other Bureaus'} and want to proceed. This acknowledgement is recorded in the case history.</span>
              </label>
            </div>)}
          <button onClick={submit} disabled={needsAck && !ack} className="w-full rounded-lg bg-navy py-2.5 text-sm font-semibold text-white hover:bg-navy-2 disabled:cursor-not-allowed disabled:opacity-40">Confirm</button>
          <p className="text-[11px] text-slate-400">Every action is time-stamped, attributed to your Bureau and added to the tamper-evident hash chain.</p>
        </div>
      </Drawer>
    </div>
  )
}
