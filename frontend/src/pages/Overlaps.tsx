import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, GitMerge, HelpCircle, Users } from 'lucide-react'
import { post, useApi } from '../api'
import { BandBadge, BureauBadge, Card, Drawer, ErrorBox, Loading, ScoreRing, StatusChip, cx, fmtDate } from '../ui'

export function BreakdownView({ pair, bureauOf, onReviewed }: { pair: any; bureauOf: (id: string) => string; onReviewed?: () => void }) {
  const [showText, setShowText] = useState(false)
  const [reviewDecision, setReviewDecision] = useState<'CONFIRMED' | 'REJECTED' | 'DEFERRED' | null>(null)
  const [rationale, setRationale] = useState('')
  const [busy, setBusy] = useState(false)
  const [currentStatus, setCurrentStatus] = useState<string>(pair.status || 'OPEN')
  const [savedRationale, setSavedRationale] = useState<string>(pair.review_rationale || '')
  const manual = pair.type === 'MANUAL'

  useEffect(() => {
    setCurrentStatus(pair.status || 'OPEN')
    setSavedRationale(pair.review_rationale || '')
    setReviewDecision(null)
    setRationale('')
  }, [pair.id, pair.status, pair.review_rationale])

  async function submitReview() {
    if (!reviewDecision || !rationale.trim()) return
    setBusy(true)
    try {
      const res = await post(`/overlaps/${pair.id}/review`, {
        decision: reviewDecision,
        rationale: rationale.trim(),
      })
      setCurrentStatus(res.status)
      setSavedRationale(res.review_rationale)
      setReviewDecision(null)
      setRationale('')
      if (onReviewed) onReviewed()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 rounded-xl bg-slate-50 p-4">
        <ScoreRing score={pair.score} band={pair.band} size={76} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <BandBadge band={pair.band} />
            {manual && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-800">Manual</span>}
            <span className={cx(
              'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
              currentStatus === 'CONFIRMED' ? 'bg-emerald-100 text-emerald-800' :
              currentStatus === 'REJECTED' ? 'bg-red-100 text-red-800' :
              currentStatus === 'DEFERRED' ? 'bg-slate-200 text-slate-700' :
              currentStatus === 'LINKED' ? 'bg-indigo-100 text-indigo-800' :
              'bg-amber-100 text-amber-800'
            )}>
              {currentStatus}
            </span>
          </div>
          <div className="mt-1.5 text-sm font-semibold text-slate-800">{pair.headline}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <BureauBadge code={bureauOf(pair.case_a)} /> <span className="font-mono">{pair.case_a}</span>
            <span>↔</span>
            <BureauBadge code={bureauOf(pair.case_b)} /> <span className="font-mono">{pair.case_b}</span>
          </div>
          {savedRationale && (
            <div className="mt-2 rounded-lg bg-white p-2 text-xs text-slate-600 ring-1 ring-slate-200">
              <span className="font-semibold text-slate-700">Recorded Rationale:</span> {savedRationale}
            </div>
          )}
        </div>
      </div>

      {/* Per-Pair Human-in-the-Loop Review Box */}
      <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm space-y-3">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
          <span>Official Investigator Review</span>
          <span className="text-[11px] text-slate-400">Recorded in SHA-256 Audit Trail</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => setReviewDecision('CONFIRMED')}
            className={cx(
              'rounded-lg border px-2 py-1.5 text-xs font-semibold transition',
              reviewDecision === 'CONFIRMED'
                ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm'
                : 'border-slate-200 text-emerald-700 hover:bg-emerald-50'
            )}>
            Confirm Link
          </button>
          <button
            onClick={() => setReviewDecision('REJECTED')}
            className={cx(
              'rounded-lg border px-2 py-1.5 text-xs font-semibold transition',
              reviewDecision === 'REJECTED'
                ? 'border-red-600 bg-red-600 text-white shadow-sm'
                : 'border-slate-200 text-red-700 hover:bg-red-50'
            )}>
            Not Related
          </button>
          <button
            onClick={() => setReviewDecision('DEFERRED')}
            className={cx(
              'rounded-lg border px-2 py-1.5 text-xs font-semibold transition',
              reviewDecision === 'DEFERRED'
                ? 'border-slate-600 bg-slate-700 text-white shadow-sm'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            )}>
            Defer Review
          </button>
        </div>

        {reviewDecision && (
          <div className="space-y-2 pt-1 border-t border-slate-100">
            <label className="block text-[11px] font-semibold text-slate-600">
              Mandatory Review Rationale for <span className="font-bold text-navy">{reviewDecision}</span>:
            </label>
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Provide evidence-based justification for this finding (required)..."
              rows={2}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs outline-none focus:border-navy-2 focus:bg-white"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setReviewDecision(null); setRationale('') }}
                className="rounded-lg px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100">
                Cancel
              </button>
              <button
                onClick={submitReview}
                disabled={busy || !rationale.trim()}
                className="rounded-lg bg-navy px-3.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-navy-2 disabled:opacity-50">
                {busy ? 'Saving to Ledger...' : 'Commit Decision to Audit Vault'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{manual ? 'Why these cases were linked' : 'Why these cases were flagged'}</div>
        <ul className="space-y-3">
          {pair.breakdown.map((s: any) => {
            const r = s.points / s.max
            const color = r >= 0.75 ? '#16a34a' : r >= 0.4 ? '#d97706' : '#94a3b8'
            return (
              <li key={s.signal}>
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className="font-medium text-slate-800">{s.label}</span>
                  <span className="num text-xs font-semibold" style={{ color }}>+{s.points} <span className="font-normal text-slate-400">/ {s.max}</span></span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full transition-all" style={{ width: `${r * 100}%`, background: color }} /></div>
                <div className="mt-1 text-xs leading-snug text-slate-500">{s.detail}</div>
              </li>)
          })}
        </ul>
        <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-900 px-3.5 py-2.5 text-sm text-white">
          {manual ? <span>Linked manually by {pair.review_by || 'an official'} — no automated score</span>
            : <><span>Total confidence</span><span className="num text-lg font-bold">{Math.round(pair.score)}%</span></>}
        </div>
      </div>
      <button className="text-xs font-medium text-navy-2 hover:underline" onClick={() => setShowText((v) => !v)}>{showText ? 'Hide' : 'Show'} plain-text explanation</button>
      {showText && <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">{pair.explanation}</pre>}
    </div>
  )
}


export function ClusterDrawer({ cluster, onClose }: { cluster: any; onClose: () => void }) {
  const [sel, setSel] = useState(0)
  const nav = useNavigate()
  useEffect(() => setSel(0), [cluster?.cluster_id])
  if (!cluster) return null
  const bureauOf = (id: string) => cluster.cases.find((c: any) => c.case_id === id)?.bureau || ''
  const pair = cluster.pairs[sel] || cluster.pairs[0]
  return (
    <Drawer open onClose={onClose} width={600}
      title={<div><div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{cluster.cluster_id} · explainable overlap</div>
        <div className="mt-0.5 font-bold text-slate-900">{cluster.institution.name}</div></div>}>
      {cluster.pairs.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {cluster.pairs.map((p: any, i: number) => (
            <button key={p.id} onClick={() => setSel(i)}
              className={cx('rounded-lg border px-2.5 py-1.5 text-xs font-medium', i === sel ? 'border-navy bg-navy text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
              {bureauOf(p.case_a)} ↔ {bureauOf(p.case_b)} · {p.type === 'MANUAL' ? 'manual' : `${Math.round(p.score)}%`}</button>))}
        </div>)}
      <BreakdownView pair={pair} bureauOf={bureauOf} />
      <div className="h-2" />
      <div className="sticky bottom-0 -mx-5 -mb-5 mt-6 border-t border-slate-200 bg-white p-4">
        <button onClick={async () => { const r = await post('/rooms', { cluster_id: cluster.cluster_id }); nav(`/rooms/${r.id}`) }}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-navy py-2.5 text-sm font-semibold text-white hover:bg-navy-2">
          <Users size={16} /> {cluster.room_id ? 'Open Coordination Room' : 'Link cases in Coordination Room'} <ArrowRight size={15} />
        </button>
      </div>
    </Drawer>
  )
}

export default function Overlaps() {
  const [sp, setSp] = useSearchParams()
  const [tab, setTab] = useState<'active' | 'all'>('active')
  const [find, setFind] = useState('')
  const nav = useNavigate()
  const { data, error, loading } = useApi<any>(`/overlaps?status=${tab}`)
  const open = sp.get('open')
  const cluster = data?.items?.find((c: any) => c.cluster_id === open)
  const { data: allData } = useApi<any>(open && !cluster ? '/overlaps?status=all' : null)
  const drawerCluster = cluster || allData?.items?.find((c: any) => c.cluster_id === open)

  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Overlapping cases</h1>
          <p className="text-sm text-slate-500">Complaints about the same institution handled by different Bureaus — detected even when names, IDs and descriptions differ.</p>
        </div>
        <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find institution, city or case ID…"
          className="w-64 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-navy-2" />
        <div className="flex rounded-lg bg-slate-200/70 p-1 text-sm">
          {(['active', 'all'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cx('rounded-md px-3 py-1.5 font-medium capitalize', tab === t ? 'bg-white shadow-sm' : 'text-slate-500')}>{t === 'active' ? 'Needs coordination' : 'All incl. resolved'}</button>))}
        </div>
      </div>

      {loading && !data ? <Loading /> : error && !data ? <ErrorBox msg={error} /> : (
        <div className="space-y-4">
          {data.items.filter((cl: any) => !find.trim() || (cl.institution.name + ' ' + cl.cluster_id + ' ' + cl.cases.map((c: any) => c.case_id + ' ' + c.submitted_institution_name).join(' ')).toLowerCase().includes(find.trim().toLowerCase())).map((cl: any) => {
            const done = cl.status === 'RESOLVED' || cl.status === 'DISMISSED'
            return (
              <Card key={cl.cluster_id} pad={false} className={cx(!done && cl.band === 'HIGH' && 'ring-red-200')}>
                <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 px-4 py-3.5">
                  <ScoreRing score={cl.score} band={cl.band} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {done ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">{cl.status}</span> : <BandBadge band={cl.band} />}
                      {cl.status === 'LINKED' && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-700">IN COORDINATION</span>}
                      {cl.pairs.some((p: any) => p.type === 'MANUAL') && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-800" title="Includes a link made by an official">MANUAL</span>}
                      <span className="font-mono text-xs text-slate-400">{cl.cluster_id}</span>
                    </div>
                    <Link to={`/institutions/${cl.institution.aicte_id}`} className="mt-1 block text-[15px] font-semibold text-slate-900 hover:underline">{cl.institution.name}</Link>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">{cl.institution.region} · {cl.cases.length} cases · handled in parallel by
                      {cl.bureaus.map((b: string) => <BureauBadge key={b} code={b} />)}</div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setSp({ open: cl.cluster_id })} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><HelpCircle size={15} /> Why flagged</button>
                    {!done && <button onClick={async () => { const r = await post('/rooms', { cluster_id: cl.cluster_id }); nav(`/rooms/${r.id}`) }}
                      className="flex items-center gap-1.5 rounded-lg bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy-2"><GitMerge size={15} /> {cl.room_id ? 'Open room' : 'Coordinate'}</button>}
                    {done && cl.room_id && <Link to={`/rooms/${cl.room_id}`} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium">View decision</Link>}
                  </div>
                </div>
                <ul className="divide-y divide-slate-100">
                  {cl.cases.map((c: any) => (
                    <li key={c.case_id} className="grid grid-cols-12 items-center gap-3 px-4 py-2.5 text-sm">
                      <div className="col-span-3 flex items-center gap-2"><BureauBadge code={c.bureau} /><Link to={`/cases/${c.case_id}`} className="font-semibold text-navy-2 hover:underline">{c.case_id}</Link></div>
                      <div className="col-span-4 truncate text-slate-600">{c.category}</div>
                      <div className="col-span-3 truncate text-xs text-slate-400" title="Name as submitted">“{c.submitted_institution_name}”{!c.submitted_aicte_id && <span className="ml-1 rounded bg-amber-50 px-1 text-amber-700">no ID</span>}</div>
                      <div className="col-span-2 flex items-center justify-end gap-2"><StatusChip status={c.status} /><span className="hidden text-xs text-slate-400 xl:inline">{fmtDate(c.received_on)}</span></div>
                    </li>))}
                </ul>
              </Card>)
          })}
          {data.items.length === 0 && <Card><div className="p-8 text-center text-slate-400">No overlaps need coordination right now.</div></Card>}
        </div>)}

      {open && drawerCluster && <ClusterDrawer cluster={drawerCluster} onClose={() => setSp({})} />}
    </div>
  )
}
