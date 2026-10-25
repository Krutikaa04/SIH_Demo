import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, CheckCircle2, Crown, GitMerge, Lock, Plus, Send, Split, Unlink } from 'lucide-react'
import { api, post, useApi, useRole } from '../api'
import { BUREAU_NAMES, BureauBadge, Card, ErrorBox, Loading, PageHeader, StatusChip, cx, fmtTs } from '../ui'
import { BreakdownView } from './Overlaps'

const OUTCOMES = [
  { v: 'MERGE', t: 'One Bureau leads', d: 'The lead Bureau handles the whole matter. The others follow its decisions.', icon: GitMerge },
  { v: 'RESOLVE', t: 'We agreed a plan', d: 'The Bureaus have agreed who does what. Mark the overlap as settled.', icon: CheckCircle2 },
  { v: 'KEEP_SEPARATE', t: 'They are unrelated', d: 'These cases are not connected. Remove the overlap warning.', icon: Split },
]
const OUTCOME_LABEL: Record<string, string> = { MERGE: 'One Bureau leads', RESOLVE: 'Agreed a plan', KEEP_SEPARATE: 'Kept separate' }

function Step({ n, done, title, hint, children, locked }: { n: number; done?: boolean; title: string; hint?: string; children: any; locked?: boolean }) {
  return (
    <section className="rise rounded-xl border border-line bg-sheet shadow-sm">
      <header className="flex items-start gap-4 px-5 pt-5">
        <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-full font-display text-lg font-semibold', done ? 'bg-emerald-600 text-white' : 'bg-navy text-white')}>
          {done ? <Check size={18} /> : n}</span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[1.25rem] font-semibold leading-tight text-slate-900">{title}</h2>
          {hint && <p className="mt-0.5 text-[13.5px] text-slate-500">{hint}</p>}
        </div>
        {locked && <Lock size={16} className="mt-1 text-slate-400" />}
      </header>
      <div className="px-5 pb-5 pt-4">{children}</div>
    </section>
  )
}

export default function Room() {
  const { id } = useParams()
  const me = useRole()
  return <RoomContent key={JSON.stringify([id, me.role, me.region])} id={id} />
}

function RoomContent({ id }: { id: string | undefined }) {
  const me = useRole()
  const { data: loadedRoom, error, loading, reload } = useApi<any>(`/rooms/${id}`)
  const [freshRoom, setFreshRoom] = useState<any>(null)
  useEffect(() => { setFreshRoom(null) }, [loadedRoom])
  const r = freshRoom || loadedRoom
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [comment, setComment] = useState('')
  const [outcome, setOutcome] = useState('MERGE')
  const [note, setNote] = useState('')
  const [pairSel, setPairSel] = useState(0)
  const [adding, setAdding] = useState(false)
  const [find, setFind] = useState('')
  const [reason, setReason] = useState('')
  const [removeReason, setRemoveReason] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)
  const [memberErr, setMemberErr] = useState('')
  const [decideErr, setDecideErr] = useState('')
  const [commentErr, setCommentErr] = useState('')
  const { data: pool } = useApi<any>(adding && r ? `/cases?institution_id=${encodeURIComponent(r.institution.aicte_id)}&page_size=200` : null, false)
  if (loading && !r) return <Loading />
  if (error && !r) return <ErrorBox msg={error} />
  if (!r || r.id !== id || (me.role === 'REGIONAL' && (!me.region || r.institution.region !== me.region))) return <Loading />
  const decided = !!r.decision
  const canDecide = me.role === 'SENIOR' || me.role === r.lead_bureau
  const bureaus: string[] = Array.from(new Set(r.cases.map((c: any) => c.bureau)))
  const canLead = me.role === 'SENIOR' || bureaus.includes(me.role)
  const bureauOf = (cid: string) => r.cases.find((c: any) => c.case_id === cid)?.bureau || ''
  const canManage = !!r.can_manage_members
  const members = new Set<string>(r.cases.map((c: any) => c.case_id))
  const needle = find.trim().toLowerCase()
  const candidates = (pool?.items || []).filter((c: any) => !members.has(c.case_id) &&
    (!needle || `${c.case_id} ${c.category} ${c.bureau}`.toLowerCase().includes(needle)))

  async function mutate(task: () => Promise<void>, fail: (message: string) => void) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try { await task() } catch (e: any) { fail(e.message) }
    finally { pending.current = false; setBusy(false) }
  }
  async function addCase(caseId: string) {
    setMemberErr('')
    await mutate(async () => { const updated = await post(`/rooms/${id}/cases`, { case_id: caseId, rationale: reason }); reload(); setFreshRoom(updated); setReason(''); setFind('') }, setMemberErr)
  }
  async function removeCase(caseId: string) {
    setMemberErr('')
    await mutate(async () => {
      const updated = await api(`/rooms/${id}/cases/${encodeURIComponent(caseId)}?reason=${encodeURIComponent(removeReason)}`, { method: 'DELETE' })
      reload(); setFreshRoom(updated); setRemoving(null); setRemoveReason('')
    }, setMemberErr)
  }
  async function send() {
    if (!comment.trim()) return
    setCommentErr('')
    await mutate(async () => { const updated = await post(`/rooms/${id}/comments`, { body: comment }); reload(); setFreshRoom(updated); setComment('') }, setCommentErr)
  }
  async function chooseLead(lead_bureau: string) {
    setDecideErr('')
    await mutate(async () => { const updated = await post(`/rooms/${id}/lead`, { lead_bureau }); reload(); setFreshRoom(updated) }, setDecideErr)
  }
  async function decide() {
    setDecideErr('')
    await mutate(async () => { const updated = await post(`/rooms/${id}/decision`, { outcome, lead_bureau: r.lead_bureau, note }); reload(); setFreshRoom(updated) }, setDecideErr)
  }

  return (
    <div className="mx-auto max-w-[1240px]">
      <PageHeader back={{ to: '/overlaps', label: 'All overlaps' }} eyebrow={<span>Coordination room · <span className="font-mono normal-case tracking-normal">{r.id}</span></span>}
        title={r.institution.name}
        subtitle={<>{r.institution.region} region · {r.cases.length} cases from {bureaus.length} Bureaus. Work through the three steps, talk it through on the right, and record what was agreed.</>}
        actions={<span className={cx('rounded-full border px-3.5 py-1.5 text-sm font-bold', decided ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-indigo-200 bg-indigo-50 text-indigo-700')}>
          {decided ? (r.status === 'MERGED' ? 'Decided: one Bureau leads' : 'Decided') : 'Open'}</span>} />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Step n={1} done title="Review the cases" hint="These are the complaints that need to be looked at together.">
            <ul className="-mx-1 divide-y divide-line">
              {r.cases.map((c: any) => (
                <li key={c.case_id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 py-3 text-sm">
                  <BureauBadge code={c.bureau} />
                  <Link to={`/cases/${c.case_id}`} className="case-id text-navy-2 hover:underline">{c.case_id}</Link>
                  {c.bureau === r.lead_bureau && <span className="flex items-center gap-1 rounded-[4px] border border-amber-300 bg-amber-50 px-1.5 py-px text-[11px] font-bold uppercase tracking-wide text-amber-800"><Crown size={11} /> Leads</span>}
                  {c.bureau !== r.lead_bureau && decided && <span className="rounded-[4px] bg-slate-100 px-1.5 py-px text-[11px] font-medium text-slate-600">follows {r.lead_bureau}</span>}
                  <span className="min-w-0 flex-1 basis-40 truncate text-slate-500">{c.category}</span>
                  <StatusChip status={c.status} />
                  <span className="hidden text-xs text-slate-400 sm:inline">{c.assigned_officer.name}</span>
                  {canManage && r.cases.length > 2 && (
                    <button title="Take this case out of the room" aria-label={`Remove ${c.case_id} from this room`}
                      onClick={() => { setRemoving(removing === c.case_id ? null : c.case_id); setRemoveReason(''); setMemberErr('') }}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Unlink size={14} /></button>)}
                  {removing === c.case_id && (
                    <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5">
                      <input value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} placeholder="Why does it not belong here? (optional)" className="field !w-auto min-w-0 flex-1 !py-1.5 text-[13px]" />
                      <button onClick={() => removeCase(c.case_id)} disabled={busy} className="btn btn-danger btn-sm">Take it out</button>
                      <button onClick={() => setRemoving(null)} className="btn btn-ghost btn-sm">Cancel</button>
                    </div>)}
                </li>))}
            </ul>
            {memberErr && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800" role="alert">{memberErr}</div>}
            {canManage && (
              <div className="mt-3">
                <button onClick={() => { setAdding((v) => !v); setMemberErr('') }} className="btn btn-ghost btn-sm"><Plus size={14} /> {adding ? 'Close' : 'Add another case'}</button>
              </div>)}
            {adding && canManage && (
              <div className="toast-in mt-3 space-y-2 rounded-xl border border-line bg-sheet p-3.5">
                <div className="text-[13px] font-semibold text-slate-700">Other cases at {r.institution.name}</div>
                <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search by case number, category or Bureau…" className="field" />
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why does it belong here? (optional, recorded on the case)" className="field" />
                <ul className="max-h-56 divide-y divide-line overflow-auto rounded-lg border border-line">
                  {candidates.length === 0 && <li className="p-3 text-[13px] text-slate-400">{pool ? 'No other cases of this institution match.' : 'Loading…'}</li>}
                  {candidates.map((c: any) => {
                    const elsewhere = c.overlap?.room_id && c.overlap.room_id !== r.id ? c.overlap.room_id : null
                    return (
                      <li key={c.case_id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2 text-sm">
                        <BureauBadge code={c.bureau} />
                        <span className="case-id text-navy-2">{c.case_id}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{c.category}</span>
                        <StatusChip status={c.status} />
                        {elsewhere ? <span className="text-[11px] text-slate-400">already in {elsewhere}</span> : (
                          <button onClick={() => addCase(c.case_id)} disabled={busy} className="btn btn-primary btn-sm">Add</button>)}
                      </li>)
                  })}
                </ul>
              </div>)}
          </Step>

          <Step n={2} done={decided} locked={!canLead && !decided} title="Agree who leads"
            hint="The lead Bureau drives one line of action. The others share what they know and avoid sending parallel notices.">
            <div className="flex flex-wrap gap-2.5">
              {bureaus.map((b) => (
                <button key={b} disabled={busy || decided || !canLead} onClick={() => chooseLead(b)} aria-pressed={r.lead_bureau === b}
                  className={cx('flex items-center gap-2.5 rounded-lg border px-4 py-3 text-left transition',
                    r.lead_bureau === b ? 'border-navy bg-navy text-white shadow-md' : 'border-line bg-sheet hover:border-slate-400', (decided || !canLead) && 'cursor-default opacity-70')}>
                  {r.lead_bureau === b && <Crown size={15} className="text-[#ffd36b]" />}
                  <span><span className="block font-mono text-[13px] font-semibold">{b}</span><span className={cx('block text-xs', r.lead_bureau === b ? 'text-white/70' : 'text-slate-500')}>{BUREAU_NAMES[b]}</span></span>
                </button>))}
            </div>
            {!canLead && !decided && <p className="mt-2.5 text-[13px] text-slate-500">Only a Bureau in this room, or Senior Management, can choose the lead.</p>}
          </Step>

          <Step n={3} done={decided} locked={!canDecide && !decided} title="Record what was decided"
            hint={decided ? undefined : 'Once recorded, this is written into the history of every case in the room.'}>
            {decided ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                <div className="flex items-center gap-2 font-display text-[1.125rem] font-semibold"><CheckCircle2 size={19} /> {OUTCOME_LABEL[r.decision.outcome]} · {r.decision.lead_bureau} leads</div>
                {r.decision.note && <p className="mt-1.5 text-[14px]">{r.decision.note}</p>}
                <div className="mt-2 text-xs text-emerald-800/80">Recorded by {r.decision.decided_by} on {fmtTs(r.decision.at)} and written to every case in the room.</div>
              </div>) : (
              <>
                <div className="grid gap-2.5 md:grid-cols-3" role="radiogroup" aria-label="Outcome">
                  {OUTCOMES.map((o) => (
                    <button key={o.v} role="radio" aria-checked={outcome === o.v} onClick={() => setOutcome(o.v)}
                      className={cx('rounded-lg border p-3.5 text-left transition', outcome === o.v ? 'border-navy bg-navy/[.04] ring-2 ring-navy' : 'border-line bg-sheet hover:border-slate-400')}>
                      <o.icon size={19} className={outcome === o.v ? 'text-navy' : 'text-slate-400'} />
                      <div className="mt-2 text-[14.5px] font-semibold leading-tight text-slate-900">{o.t}</div>
                      <div className="mt-1 text-[12.5px] leading-snug text-slate-500">{o.d}</div>
                    </button>))}
                </div>
                <label className="mt-3 block"><span className="mb-1.5 block text-[13px] font-semibold">Note for the record <span className="font-normal text-slate-400">(optional)</span></span>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="field"
                    placeholder="For example: RB sends one show-cause notice; PGRC passes on the students’ statements" /></label>
                {decideErr && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800" role="alert">{decideErr}</div>}
                <button onClick={decide} disabled={busy || !canDecide} className="btn btn-primary mt-4 !py-3">{busy ? 'Saving…' : `Record the decision (${r.lead_bureau} leads)`}</button>
                {!canDecide && <p className="mt-2 text-[13px] text-slate-500">Only the lead Bureau ({r.lead_bureau}) or Senior Management can record the decision.</p>}
              </>)}
          </Step>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card className="rise rise-1" title="Talk it through" subtitle="Everyone in the room sees this.">
            <ul className="max-h-80 space-y-3 overflow-auto pr-1">
              {r.comments.length === 0 && <li className="text-sm text-slate-400">Nobody has written anything yet. Start the conversation.</li>}
              {r.comments.map((c: any, i: number) => (
                <li key={i} className={cx('rounded-lg p-3 text-sm', c.role === 'SYS' ? 'bg-slate-100/70 text-slate-500' : 'border border-indigo-100 bg-indigo-50/60')}>
                  <div className="mb-0.5 flex items-center gap-2 text-xs"><b className="text-slate-800">{c.author}</b>
                    {c.role !== 'SYS' && <BureauBadge code={c.role} />}<span className="text-slate-400">{fmtTs(c.ts)}</span></div>
                  <span className="leading-relaxed">{c.body}</span>
                </li>))}
            </ul>
            {!decided && (
              <div className="mt-3 flex gap-2">
                <input value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} aria-label="Write a message"
                  placeholder="Write a message to the other Bureaus…" className="field min-w-0 flex-1" />
                <button onClick={send} disabled={busy || !comment.trim()} className="btn btn-primary" aria-label="Send"><Send size={15} /></button>
              </div>)}
            {commentErr && <p className="mt-2 text-sm text-red-800" role="alert">{commentErr}</p>}
          </Card>

          <Card className="rise rise-2" title="Why these cases are linked">
            {r.pairs.length > 1 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {r.pairs.map((p: any, i: number) => (
                  <button key={p.id} onClick={() => setPairSel(i)} className={cx('rounded-md border px-2.5 py-1 text-xs font-semibold', i === pairSel ? 'border-navy bg-navy text-white' : 'border-line text-slate-600 hover:border-slate-300')}>
                    {bureauOf(p.case_a)} and {bureauOf(p.case_b)} · {p.type === 'MANUAL' ? 'manual' : `${Math.round(p.score)}%`}</button>))}
              </div>)}
            {r.pairs.length > 0 ? <BreakdownView pair={r.pairs[pairSel] || r.pairs[0]} bureauOf={bureauOf} />
              : <p className="text-sm text-slate-400">No link evidence recorded for this room.</p>}
          </Card>

          <Card className="rise rise-3" title="Everything that happened" subtitle="Across all the cases in this room, newest first.">
            <ol className="max-h-[28rem] space-y-3.5 overflow-auto border-l border-line pl-4 pr-1">
              {r.timeline.map((e: any, i: number) => (
                <li key={i} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-slate-300 ring-4 ring-sheet" />
                  <div className="flex flex-wrap items-center gap-2"><BureauBadge code={e.actor.bureau} /><span className="font-semibold text-slate-800">{e.action_type.replace(/_/g, ' ').toLowerCase().replace(/^./, (m: string) => m.toUpperCase())}</span><span className="text-[11.5px] text-slate-400">{fmtTs(e.ts)}</span></div>
                  <div className="mt-0.5 text-[13px] text-slate-500"><span className="case-id text-slate-600">{e.case_id}</span> — {e.remarks}</div>
                </li>))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  )
}
