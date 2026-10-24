import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Crown, GitMerge, Plus, Send, Split, Unlink, Users } from 'lucide-react'
import { api, post, useApi, useRole } from '../api'
import { BureauBadge, Card, ErrorBox, Loading, ScoreRing, StatusChip, cx, fmtTs } from '../ui'
import { BreakdownView } from './Overlaps'

const OUTCOMES = [
  { v: 'MERGE', t: 'Merge under lead Bureau', d: 'Lead Bureau takes the combined matter; other Bureaus follow its lead.', icon: GitMerge },
  { v: 'RESOLVE', t: 'Coordinated — resolve', d: 'Bureaus agreed an action plan; overlap is closed.', icon: CheckCircle2 },
  { v: 'KEEP_SEPARATE', t: 'Keep separate', d: 'Cases are unrelated; dismiss the overlap flag.', icon: Split },
]

export default function Room() {
  const { id } = useParams()
  const me = useRole()
  const { data: r, error, loading, reload } = useApi<any>(`/rooms/${id}`)
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
  const { data: pool } = useApi<any>(adding && r ? `/cases?institution_id=${encodeURIComponent(r.institution.aicte_id)}&page_size=200` : null, false)
  if (loading && !r) return <Loading />
  if (error && !r) return <ErrorBox msg={error} />
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

  async function addCase(caseId: string) {
    setMemberErr('')
    try { await post(`/rooms/${id}/cases`, { case_id: caseId, rationale: reason }); setReason(''); setFind(''); reload() }
    catch (e: any) { setMemberErr(e.message) }
  }
  async function removeCase(caseId: string) {
    setMemberErr('')
    try {
      await api(`/rooms/${id}/cases/${encodeURIComponent(caseId)}?reason=${encodeURIComponent(removeReason)}`, { method: 'DELETE' })
      setRemoving(null); setRemoveReason(''); reload()
    } catch (e: any) { setMemberErr(e.message) }
  }

  async function send() {
    if (!comment.trim()) return
    await post(`/rooms/${id}/comments`, { body: comment })
    setComment(''); reload()
  }

  return (
    <div className="mx-auto max-w-[1300px] space-y-5">
      <Link to="/overlaps" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={15} /> Overlaps</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3"><div className="rounded-lg bg-navy p-2 text-white"><Users size={18} /></div>
            <h1 className="text-xl font-bold tracking-tight">Coordination Room <span className="font-mono text-base text-slate-400">{r.id}</span></h1>
            <span className={cx('rounded-full px-2.5 py-0.5 text-xs font-bold', decided ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700')}>{decided ? r.status : 'OPEN'}</span></div>
          <Link to={`/institutions/${r.institution.aicte_id}`} className="mt-1 block text-slate-600 hover:underline">{r.institution.name} · {r.institution.region}</Link>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card title="1 · Linked cases"
            right={canManage ? (
              <button onClick={() => { setAdding((v) => !v); setMemberErr('') }}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                <Plus size={13} /> {adding ? 'Close' : 'Add case'}</button>) : undefined}>
            <ul className="divide-y divide-slate-100">
              {r.cases.map((c: any) => (
                <li key={c.case_id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <BureauBadge code={c.bureau} />
                  <Link to={`/cases/${c.case_id}`} className="font-semibold text-navy-2 hover:underline">{c.case_id}</Link>
                  {c.bureau === r.lead_bureau && <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800"><Crown size={11} /> LEAD</span>}
                  {c.bureau !== r.lead_bureau && decided && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">follows {r.lead_bureau}</span>}
                  <span className="flex-1 truncate text-slate-500">{c.category}</span>
                  <StatusChip status={c.status} />
                  <span className="text-xs text-slate-400">{c.assigned_officer.name}</span>
                  {canManage && r.cases.length > 2 && (
                    <button title="Remove from this room" aria-label={`Remove ${c.case_id} from this room`}
                      onClick={() => { setRemoving(removing === c.case_id ? null : c.case_id); setRemoveReason(''); setMemberErr('') }}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Unlink size={14} /></button>)}
                  {removing === c.case_id && (
                    <div className="flex w-full items-center gap-2 rounded-lg bg-red-50 p-2">
                      <input value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} placeholder="Why is this case unrelated? (optional)"
                        className="flex-1 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs outline-none" />
                      <button onClick={() => removeCase(c.case_id)} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">Remove</button>
                      <button onClick={() => setRemoving(null)} className="rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-white">Cancel</button>
                    </div>)}
                </li>))}
            </ul>
            {memberErr && <div className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs text-red-700">{memberErr}</div>}
            {adding && canManage && (
              <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-700">Add a case of {r.institution.name}</div>
                <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search by case ID, category or Bureau…"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-navy-2" />
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for linking (optional, recorded on the case)"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-navy-2" />
                <ul className="max-h-56 divide-y divide-slate-100 overflow-auto rounded-lg bg-white ring-1 ring-slate-200">
                  {candidates.length === 0 && <li className="p-3 text-xs text-slate-400">{pool ? 'No other cases of this institution match.' : 'Loading…'}</li>}
                  {candidates.map((c: any) => {
                    const elsewhere = c.overlap?.room_id && c.overlap.room_id !== r.id ? c.overlap.room_id : null
                    return (
                      <li key={c.case_id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2 text-sm">
                        <BureauBadge code={c.bureau} />
                        <span className="font-mono text-xs font-semibold text-navy-2">{c.case_id}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{c.category}</span>
                        <StatusChip status={c.status} />
                        {elsewhere ? <span className="text-[11px] text-slate-400">in {elsewhere}</span> : (
                          <button onClick={() => addCase(c.case_id)} className="rounded-md bg-navy px-2.5 py-1 text-xs font-semibold text-white hover:bg-navy-2">Add</button>)}
                      </li>)
                  })}
                </ul>
              </div>)}
          </Card>

          <Card title="2 · Choose the lead Bureau">
            <div className="flex flex-wrap gap-2">
              {bureaus.map((b) => (
                <button key={b} disabled={decided} onClick={async () => { await post(`/rooms/${id}/lead`, { lead_bureau: b }); reload() }}
                  className={cx('flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition',
                    r.lead_bureau === b ? 'border-navy bg-navy text-white shadow' : 'border-slate-200 hover:bg-slate-50', decided && 'cursor-default opacity-70')}>
                  {r.lead_bureau === b && <Crown size={14} className="text-amber-300" />} {b}</button>))}
            </div>
            <p className="mt-2 text-xs text-slate-500">The lead Bureau drives the single line of action; the others share inputs and avoid parallel notices.</p>
          </Card>

          <Card title="3 · Discussion">
            <ul className="max-h-72 space-y-3 overflow-auto pr-1">
              {r.comments.length === 0 && <li className="text-sm text-slate-400">No comments yet — start the conversation.</li>}
              {r.comments.map((c: any, i: number) => (
                <li key={i} className={cx('rounded-lg p-3 text-sm', c.role === 'SYS' ? 'bg-slate-50 text-slate-500' : 'bg-indigo-50/60')}>
                  <div className="mb-0.5 flex items-center gap-2 text-xs"><b className="text-slate-700">{c.author}</b>
                    {c.role !== 'SYS' && <BureauBadge code={c.role} />}<span className="text-slate-400">{fmtTs(c.ts)}</span></div>
                  {c.body}
                </li>))}
            </ul>
            {!decided && (
              <div className="mt-3 flex gap-2">
                <input value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
                  placeholder="Write a comment for the other Bureaus…" className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-navy-2" />
                <button onClick={send} className="flex items-center gap-1.5 rounded-lg bg-navy px-3.5 text-sm font-semibold text-white hover:bg-navy-2"><Send size={14} /> Send</button>
              </div>)}
          </Card>

          <Card title="4 · Decision">
            {decided ? (
              <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">
                <div className="flex items-center gap-2 font-semibold"><CheckCircle2 size={18} /> {OUTCOMES.find((o) => o.v === r.decision.outcome)?.t} · lead {r.decision.lead_bureau}</div>
                {r.decision.note && <p className="mt-1">{r.decision.note}</p>}
                <div className="mt-1 text-xs text-emerald-700/80">Recorded by {r.decision.decided_by} · {fmtTs(r.decision.at)} · written to every linked case's audit trail.</div>
              </div>) : (
              <>
                <div className="grid gap-2 md:grid-cols-3">
                  {OUTCOMES.map((o) => (
                    <button key={o.v} onClick={() => setOutcome(o.v)}
                      className={cx('rounded-lg border p-3 text-left transition', outcome === o.v ? 'border-navy bg-navy/5 ring-1 ring-navy' : 'border-slate-200 hover:bg-slate-50')}>
                      <o.icon size={18} className={outcome === o.v ? 'text-navy' : 'text-slate-400'} />
                      <div className="mt-1.5 text-sm font-semibold">{o.t}</div><div className="mt-0.5 text-xs text-slate-500">{o.d}</div>
                    </button>))}
                </div>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Decision note (e.g. RB issues a single show-cause notice; PGRC forwards student statements)"
                  className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-navy-2" />
                <button onClick={async () => { await post(`/rooms/${id}/decision`, { outcome, lead_bureau: r.lead_bureau, note }); reload() }}
                  className="mt-3 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">Record decision (lead: {r.lead_bureau})</button>
              </>)}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Why these cases are linked">
            {r.pairs.length > 1 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {r.pairs.map((p: any, i: number) => (
                  <button key={p.id} onClick={() => setPairSel(i)} className={cx('rounded-md border px-2 py-1 text-[11px] font-medium', i === pairSel ? 'border-navy bg-navy text-white' : 'border-slate-200 text-slate-600')}>
                    {bureauOf(p.case_a)}↔{bureauOf(p.case_b)} {p.type === 'MANUAL' ? 'manual' : `${Math.round(p.score)}%`}</button>))}
              </div>)}
            {r.pairs.length > 0 ? <BreakdownView pair={r.pairs[pairSel] || r.pairs[0]} bureauOf={bureauOf} />
              : <p className="text-sm text-slate-400">No link evidence recorded for this room.</p>}
          </Card>
          <Card title="Combined timeline">
            <ol className="max-h-[480px] space-y-3 overflow-auto pr-1">
              {r.timeline.map((e: any, i: number) => (
                <li key={i} className="text-sm">
                  <div className="flex items-center gap-2"><BureauBadge code={e.actor.bureau} /><span className="font-medium text-slate-700">{e.action_type.replace('_', ' ')}</span><span className="text-[11px] text-slate-400">{fmtTs(e.ts)}</span></div>
                  <div className="mt-0.5 text-xs text-slate-500">{e.case_id} — {e.remarks}</div>
                </li>))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  )
}
