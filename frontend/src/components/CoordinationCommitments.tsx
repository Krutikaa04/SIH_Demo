import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ClipboardList, Plus, X } from 'lucide-react'
import { post, useApi, useRole } from '../api'
import type { RoleState } from '../api'
import { BureauBadge, Card, EmptyState, ErrorBox, Loading, cx, fmtDate, fmtTs } from '../ui'

type Commitment = {
  id: number; case_id: string; case_url: string; title: string; owner_bureau: string; due_on: string
  status: 'OPEN' | 'DONE'; overdue: boolean; can_complete: boolean; is_room_member: boolean
  current_bureau: string | null; completed_by: string | null; completed_at: string | null; completion_note: string | null
}
type Plan = {
  room_id: string; region: string; role: string; scope_region: string; as_of: string
  can_create: boolean; create_disabled_reason: string
  cases: { case_id: string; bureau_code: string; category: string; status: string }[]
  counts: { open: number; done: number; overdue: number }; items: Commitment[]
}

function CommitmentPanel({ roomId, identity }: { roomId: string; identity: RoleState }) {
  const { data, error, loading, reload } = useApi<Plan>(`/rooms/${encodeURIComponent(roomId)}/commitments`)
  const [adding, setAdding] = useState(false)
  const [caseId, setCaseId] = useState('')
  const [title, setTitle] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [completing, setCompleting] = useState<number | null>(null)
  const [evidence, setEvidence] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const [writeError, setWriteError] = useState('')
  const expectedRegion = identity.role === 'REGIONAL' ? identity.region : ''
  const matches = data?.room_id === roomId && data.role === identity.role && data.scope_region === expectedRegion
    && (identity.role !== 'REGIONAL' || Boolean(identity.region))

  async function create() {
    if (!data || saving.current) return
    saving.current = true
    setBusy(true); setWriteError('')
    try {
      await post(`/rooms/${encodeURIComponent(roomId)}/commitments`, {
        case_id: caseId || data.cases[0]?.case_id, title, due_on: dueOn,
      })
      setAdding(false); setTitle(''); setCaseId(''); setDueOn(''); reload()
    } catch (err: unknown) { setWriteError(err instanceof Error ? err.message : 'Could not save the commitment.') }
    finally { saving.current = false; setBusy(false) }
  }
  async function complete(id: number) {
    if (saving.current) return
    saving.current = true
    setBusy(true); setWriteError('')
    try {
      await post(`/rooms/${encodeURIComponent(roomId)}/commitments/${id}/complete`, { completion_note: evidence })
      setCompleting(null); setEvidence(''); reload()
    } catch (err: unknown) { setWriteError(err instanceof Error ? err.message : 'Could not record completion.') }
    finally { saving.current = false; setBusy(false) }
  }

  if (error) return <Card title="Joint action commitments"><ErrorBox msg={error} /></Card>
  if ((loading && !data) || !matches || !data) return <Card title="Joint action commitments"><Loading /></Card>
  const selected = data.cases.find((c) => c.case_id === (caseId || data.cases[0]?.case_id))

  return (
    <Card title={<span className="flex items-center gap-2"><ClipboardList size={18} className="text-saffron" /> Joint action commitments</span>}
      subtitle="Agree who will do what, then record the evidence of completion. These commitments do not close complaints."
      right={data.can_create && <button onClick={() => { setAdding(!adding); setWriteError('') }} disabled={busy}
        className="btn btn-ghost btn-sm" aria-expanded={adding}>{adding ? <X size={14} /> : <Plus size={14} />}{adding ? 'Cancel' : 'Add a commitment'}</button>}>
      <div className="mb-4 grid grid-cols-3 gap-2 text-sm">
        {[['Still open', data.counts.open], ['Past due', data.counts.overdue], ['Done', data.counts.done]].map(([label, count]) =>
          <div key={label} className="rounded-lg border border-line bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{label}</div><div className="font-display num mt-0.5 text-xl font-semibold text-slate-900">{count}</div></div>)}
      </div>
      {adding && data.can_create && <form className="mb-5 space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4"
        onSubmit={(event) => { event.preventDefault(); void create() }}>
        <label className="block text-[13px] font-semibold text-slate-700">Linked complaint
          <select className="field mt-1 w-full" value={caseId || data.cases[0]?.case_id || ''} onChange={(event) => setCaseId(event.target.value)} required disabled={busy}>
            {data.cases.map((c) => <option key={c.case_id} value={c.case_id}>{c.case_id} · {c.bureau_code} · {c.category}</option>)}
          </select>
        </label>
        <p className="text-xs text-slate-500">Responsible Bureau: <b className="text-slate-700">{selected?.bureau_code || 'Select a case'}</b>. The case's current Bureau becomes the recorded owner.</p>
        <label className="block text-[13px] font-semibold text-slate-700">What needs to be done?
          <input className="field mt-1 w-full" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} required disabled={busy}
            placeholder="For example, share the original fee circular with the lead Bureau" />
        </label>
        <label className="block text-[13px] font-semibold text-slate-700">Agreed due date
          <input type="date" className="field mt-1 w-full" value={dueOn} min={data.as_of} onChange={(event) => setDueOn(event.target.value)} required disabled={busy} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || !data.cases.length}>{busy ? 'Saving…' : 'Record commitment'}</button>
      </form>}
      {writeError && <div className="mb-4" role="alert"><ErrorBox msg={writeError} /></div>}
      {data.items.length ? <ul className="space-y-3">
        {data.items.map((item) => <li key={item.id} className={cx('rounded-xl border p-4', item.overdue ? 'border-red-200 bg-red-50/40' : 'border-line bg-white')}>
          <div className="flex flex-wrap items-start gap-2">
            <h3 className="min-w-0 flex-1 break-words text-[14px] font-semibold text-slate-900">{item.title}</h3>
            <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-bold', item.status === 'DONE' ? 'bg-emerald-50 text-emerald-800' : item.overdue ? 'bg-red-100 text-red-800' : 'bg-amber-50 text-amber-800')}>
              {item.status === 'DONE' ? 'Done' : item.overdue ? 'Past due' : 'Open'}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <BureauBadge code={item.owner_bureau} /><span>due {fmtDate(item.due_on)}</span>
            <Link to={item.case_url} className="case-id break-all text-navy hover:underline">{item.case_id}</Link>
          </div>
          {(!item.is_room_member || item.current_bureau !== item.owner_bureau) && <p className="mt-2 text-xs leading-relaxed text-slate-500">
            {!item.is_room_member ? 'This case is no longer a room member. ' : ''}
            {item.current_bureau && item.current_bureau !== item.owner_bureau ? `The case is now held by ${item.current_bureau}. ` : ''}
            This commitment remains with its recorded owner, {item.owner_bureau}.
          </p>}
          {item.status === 'DONE' ? <div className="mt-3 border-t border-line pt-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800"><CheckCircle2 size={13} /> Recorded by {item.completed_by} · {fmtTs(item.completed_at)}</div>
            <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-slate-600">{item.completion_note}</p>
          </div> : item.can_complete && (completing === item.id ? <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void complete(item.id) }}>
            <label className="block text-[13px] font-semibold text-slate-700">What evidence shows this is done?
              <textarea className="field mt-1 w-full" rows={3} value={evidence} onChange={(event) => setEvidence(event.target.value)} maxLength={2000} required disabled={busy}
                placeholder="Describe the action and cite the document, response or case note that supports it." />
            </label>
            <div className="flex flex-wrap gap-2"><button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Recording…' : 'Mark done with evidence'}</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setCompleting(null); setEvidence(''); setWriteError('') }}>Cancel</button></div>
          </form> : <button className="btn btn-ghost btn-sm mt-3" disabled={busy} onClick={() => { setCompleting(item.id); setEvidence(''); setWriteError('') }}>Record completion</button>)}
        </li>)}
      </ul> : <EmptyState icon={ClipboardList} title="No commitments recorded yet">The lead Bureau or Senior Management can assign a concrete next step to one of the linked cases.</EmptyState>}
      {!data.can_create && <p className="mt-4 text-xs leading-relaxed text-slate-500">{data.create_disabled_reason}</p>}
    </Card>
  )
}

export default function CoordinationCommitments({ roomId }: { roomId: string }) {
  const identity = useRole()
  return <CommitmentPanel key={`${roomId}:${identity.role}:${identity.region}`} roomId={roomId} identity={identity} />
}
