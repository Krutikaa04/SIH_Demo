import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, CheckCircle2, GitMerge, HelpCircle, Search, Users } from 'lucide-react'
import { post, useApi } from '../api'
import { BandBadge, BureauBadge, Card, Drawer, EmptyState, ErrorBox, Loading, PageHeader, ScoreRing, Segmented, StatusChip, cx, fmtDate } from '../ui'

const PAIR_STATUS: Record<string, [string, string]> = {
  OPEN: ['Open', 'border-amber-200 bg-amber-50 text-amber-800'], LINKED: ['In coordination', 'border-indigo-200 bg-indigo-50 text-indigo-800'],
  CONFIRMED: ['Confirmed related', 'border-emerald-200 bg-emerald-50 text-emerald-800'], REJECTED: ['Ruled out', 'border-red-200 bg-red-50 text-red-800'],
  DEFERRED: ['Decision postponed', 'border-slate-300 bg-slate-100 text-slate-700'], RESOLVED: ['Settled', 'border-emerald-200 bg-emerald-50 text-emerald-800'],
  DISMISSED: ['Kept separate', 'border-slate-300 bg-slate-100 text-slate-700'],
}
const DECISIONS = [
  { v: 'CONFIRMED', label: 'Yes, they are related', tone: 'border-emerald-600 bg-emerald-600 text-white', idle: 'text-emerald-800 hover:bg-emerald-50' },
  { v: 'REJECTED', label: 'No, unrelated', tone: 'border-red-600 bg-red-600 text-white', idle: 'text-red-800 hover:bg-red-50' },
  { v: 'DEFERRED', label: 'Decide later', tone: 'border-slate-700 bg-slate-700 text-white', idle: 'text-slate-700 hover:bg-slate-100' },
] as const

/** The engine writes "cosine 0.10; shared terms: placement". People need "both mention: placement". */
const plain = (d: string) => {
  const terms = d.match(/shared terms: (.+)$/)
  if (/^cosine/.test(d)) return terms ? `Both complaints mention: ${terms[1]}` : 'The wording is similar'
  return d
}
const strength = (r: number) => (r >= 0.75 ? ['Strong', '#10b981'] : r >= 0.4 ? ['Some', '#ff8a1f'] : ['Weak', '#8792b8'])

export function BreakdownView({ pair, bureauOf, onReviewed }: { pair: any; bureauOf: (id: string) => string; onReviewed?: () => void }) {
  const [showText, setShowText] = useState(false)
  const [showScore, setShowScore] = useState(false)
  const [reviewDecision, setReviewDecision] = useState<'CONFIRMED' | 'REJECTED' | 'DEFERRED' | null>(null)
  const [rationale, setRationale] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
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
    setBusy(true); setErr('')
    try {
      const res = await post(`/overlaps/${pair.id}/review`, { decision: reviewDecision, rationale: rationale.trim() })
      setCurrentStatus(res.status)
      setSavedRationale(res.review_rationale)
      setReviewDecision(null)
      setRationale('')
      if (onReviewed) onReviewed()
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  const [stLabel, stTone] = PAIR_STATUS[currentStatus] || PAIR_STATUS.OPEN

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 rounded-xl border border-line bg-slate-100/60 p-4">
        <ScoreRing score={pair.score} band={pair.band} size={76} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <BandBadge band={pair.band} />
            {manual && <span className="rounded-[4px] border border-indigo-200 bg-indigo-50 px-1.5 py-px text-[11px] font-bold uppercase tracking-wider text-indigo-700">Linked by an officer</span>}
            <span className={cx('rounded-[4px] border px-1.5 py-px text-[11px] font-bold uppercase tracking-wider', stTone)}>{stLabel}</span>
          </div>
          <div className="font-display mt-1.5 text-[1.0625rem] font-semibold leading-snug text-slate-900">{pair.headline}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <BureauBadge code={bureauOf(pair.case_a)} /> <span className="case-id">{pair.case_a}</span>
            <span>and</span>
            <BureauBadge code={bureauOf(pair.case_b)} /> <span className="case-id">{pair.case_b}</span>
          </div>
        </div>
      </div>
      {savedRationale && (
        <div className="rounded-lg border border-line bg-sheet p-3 text-[13.5px] text-slate-700">
          <span className="eyebrow mr-2">Recorded reason</span>{savedRationale}
        </div>)}

      <div>
        <h4 className="font-display mb-3 text-[1.0625rem] font-semibold">{manual ? 'Why an officer linked them' : 'Why we think they are related'}</h4>
        <ul className="space-y-3.5">
          {pair.breakdown.map((s: any) => {
            const r = s.points / s.max
            const [word, color] = strength(r)
            return (
              <li key={s.signal}>
                <div className="mb-1 flex items-baseline justify-between text-[14px]">
                  <span className="font-semibold text-slate-800">{s.label}</span>
                  <span className="text-xs font-bold uppercase tracking-wider" style={{ color }}>{manual ? '' : word}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full transition-all" style={{ width: `${r * 100}%`, background: color }} /></div>
                <div className="mt-1 text-[13px] leading-snug text-slate-500">{plain(s.detail)}</div>
              </li>)
          })}
        </ul>
        <div className="mt-4 flex flex-wrap gap-4 text-[12.5px]">
          <button className="font-semibold text-slate-500 hover:text-slate-900" onClick={() => setShowScore((v) => !v)}>{showScore ? 'Hide' : 'Show'} the scoring</button>
          <button className="font-semibold text-slate-500 hover:text-slate-900" onClick={() => setShowText((v) => !v)}>{showText ? 'Hide' : 'Show'} the full written explanation</button>
        </div>
        {showScore && (
          <div className="mt-2 rounded-lg bg-navy px-4 py-3 text-sm text-white">
            {manual ? <>Linked by {pair.review_by || 'an official'}. There is no automatic score for a manual link.</> : <div className="flex items-center justify-between"><span>Overall match</span><span className="font-display num text-xl font-semibold">{Math.round(pair.score)}%</span></div>}
            {!manual && <ul className="mt-2 space-y-0.5 text-[12.5px] text-white/75">{pair.breakdown.map((s: any) => <li key={s.signal} className="flex justify-between"><span>{s.label}</span><span className="num">{s.points} / {s.max}</span></li>)}</ul>}
          </div>)}
        {showText && <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-100 p-3 text-xs leading-relaxed text-slate-700">{pair.explanation}</pre>}
      </div>

      <div className="space-y-3 rounded-xl border border-line bg-sheet p-4 shadow-sm">
        <div>
          <div className="font-display text-[1.0625rem] font-semibold">Your judgement</div>
          <p className="text-[12.5px] text-slate-500">The system suggests; you decide. Saved in the permanent record of both cases.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {DECISIONS.map((d) => (
            <button key={d.v} onClick={() => setReviewDecision(d.v)} aria-pressed={reviewDecision === d.v}
              className={cx('rounded-lg border px-2.5 py-2.5 text-[13px] font-semibold transition', reviewDecision === d.v ? d.tone : cx('border-line bg-sheet', d.idle))}>{d.label}</button>))}
        </div>
        {reviewDecision && (
          <div className="space-y-2.5 border-t border-line pt-3">
            <label className="block text-[13px] font-semibold text-slate-700">Why? <span className="ml-1 text-xs font-medium text-red-600">Required</span>
              <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={2} className="field mt-1.5 font-normal"
                placeholder="A line or two that someone else could follow later" /></label>
            {err && <div className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700" role="alert">{err}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setReviewDecision(null); setRationale('') }} className="btn btn-ghost btn-sm">Cancel</button>
              <button onClick={submitReview} disabled={busy || !rationale.trim()} className="btn btn-primary btn-sm">{busy ? 'Saving…' : 'Save my decision'}</button>
            </div>
          </div>)}
      </div>
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
    <Drawer open onClose={onClose} width={620}
      title={<div><div className="eyebrow">{cluster.cluster_id} · why these cases were flagged</div>
        <div className="font-display mt-1 text-[1.5rem] font-semibold leading-tight text-slate-900">{cluster.institution.name}</div></div>}>
      {cluster.pairs.length > 1 && (
        <div className="mb-5">
          <div className="eyebrow mb-2">Pairs of cases ({cluster.pairs.length})</div>
          <div className="flex flex-wrap gap-2">
            {cluster.pairs.map((p: any, i: number) => (
              <button key={p.id} onClick={() => setSel(i)}
                className={cx('rounded-lg border px-3 py-1.5 text-[13px] font-semibold transition', i === sel ? 'border-navy bg-navy text-white' : 'border-line bg-sheet text-slate-600 hover:border-slate-300')}>
                {bureauOf(p.case_a)} and {bureauOf(p.case_b)} · {p.type === 'MANUAL' ? 'manual' : `${Math.round(p.score)}%`}</button>))}
          </div>
        </div>)}
      <BreakdownView pair={pair} bureauOf={bureauOf} />
      <div className="sticky bottom-0 -mx-6 -mb-6 mt-8 border-t border-line bg-sheet/95 p-4 backdrop-blur">
        <button onClick={async () => { const r = await post('/rooms', { cluster_id: cluster.cluster_id }); nav(`/rooms/${r.id}`) }} className="btn btn-primary w-full !py-3">
          <Users size={16} /> {cluster.room_id ? 'Open the coordination room' : 'Start coordinating these cases'} <ArrowRight size={15} />
        </button>
      </div>
    </Drawer>
  )
}

/** One sentence on why a cluster exists, from its strongest pair. */
const because = (cl: any) => {
  const top = [...(cl.pairs[0]?.breakdown || [])].filter((s: any) => s.points > 0).sort((a: any, b: any) => b.points / b.max - a.points / a.max).slice(0, 3)
  if (cl.pairs.some((p: any) => p.type === 'MANUAL') && !top.length) return 'Linked by an officer.'
  return top.length ? `Flagged because of: ${top.map((s: any) => s.label.toLowerCase()).join(', ')}.` : ''
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
  const needle = find.trim().toLowerCase()
  const items = (data?.items || []).filter((cl: any) => !needle || (cl.institution.name + ' ' + cl.cluster_id + ' ' + cl.cases.map((c: any) => c.case_id + ' ' + c.submitted_institution_name).join(' ')).toLowerCase().includes(needle))

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader eyebrow="Coordination" title="Cases that overlap"
        subtitle="Different Bureaus are handling complaints about the same institution at the same time. Agree who leads, so the institution is not contacted twice and no one works against another."
        actions={<Segmented label="Which overlaps" value={tab} onChange={setTab} options={[['active', 'Needs coordination'], ['all', 'Including settled']] as const} />} />

      <label className="relative mb-5 block max-w-md">
        <span className="sr-only">Find an overlap</span>
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find by institution or case number" className="field !rounded-full !pl-10" />
      </label>

      {loading && !data ? <Loading /> : error && !data ? <ErrorBox msg={error} /> : (
        <div className="space-y-5">
          {items.map((cl: any, n: number) => {
            const done = cl.status === 'RESOLVED' || cl.status === 'DISMISSED'
            const manual = cl.pairs.some((p: any) => p.type === 'MANUAL')
            return (
              <Card key={cl.cluster_id} pad={false} className={cx('rise relative overflow-hidden', done && 'opacity-90')}>
                <span className={cx('absolute inset-y-0 left-0 w-1', done ? 'bg-emerald-500' : cl.band === 'HIGH' ? 'bg-red-500' : 'bg-orange-400')} />
                <div className="flex flex-wrap items-start gap-x-5 gap-y-3 border-b border-line py-4 pl-7 pr-5" style={{ animationDelay: `${n * 40}ms` }}>
                  <ScoreRing score={cl.score} band={cl.band} />
                  <div className="min-w-0 flex-1 basis-72">
                    <div className="flex flex-wrap items-center gap-2">
                      {done ? <span className="flex items-center gap-1 rounded-[4px] border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[11px] font-bold uppercase tracking-wider text-emerald-700"><CheckCircle2 size={11} /> {cl.status === 'RESOLVED' ? 'Settled' : 'Kept separate'}</span> : <BandBadge band={cl.band} />}
                      {cl.status === 'LINKED' && <span className="rounded-[4px] border border-indigo-200 bg-indigo-50 px-1.5 py-px text-[11px] font-bold uppercase tracking-wider text-indigo-700">In coordination</span>}
                      {manual && <span className="rounded-[4px] border border-indigo-200 bg-indigo-50 px-1.5 py-px text-[11px] font-bold uppercase tracking-wider text-indigo-700" title="Includes a link made by an officer">Linked by an officer</span>}
                      <span className="font-mono text-[11px] text-slate-400">{cl.cluster_id}</span>
                    </div>
                    <Link to={`/institutions/${cl.institution.aicte_id}`} className="font-display mt-1 block text-[1.25rem] font-semibold leading-snug text-slate-900 hover:underline">{cl.institution.name}</Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-slate-500">
                      {cl.institution.region} region · {cl.cases.length} cases handled in parallel by {cl.bureaus.map((b: string) => <BureauBadge key={b} code={b} />)}
                    </div>
                    {because(cl) && <div className="mt-1.5 text-[13px] text-slate-500">{because(cl)}</div>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setSp({ open: cl.cluster_id })} className="btn btn-ghost btn-sm"><HelpCircle size={15} /> Why flagged?</button>
                    {!done && <button onClick={async () => { const r = await post('/rooms', { cluster_id: cl.cluster_id }); nav(`/rooms/${r.id}`) }} className="btn btn-primary btn-sm"><GitMerge size={15} /> {cl.room_id ? 'Open the room' : 'Start coordinating'}</button>}
                    {done && cl.room_id && <Link to={`/rooms/${cl.room_id}`} className="btn btn-ghost btn-sm">See the decision</Link>}
                  </div>
                </div>
                <ul className="divide-y divide-line pl-2">
                  {cl.cases.map((c: any) => (
                    <li key={c.case_id} className="grid grid-cols-12 items-center gap-3 py-2.5 pl-5 pr-5 text-sm">
                      <div className="col-span-12 flex items-center gap-2 sm:col-span-4"><BureauBadge code={c.bureau} /><Link to={`/cases/${c.case_id}`} className="case-id text-navy-2 hover:underline">{c.case_id}</Link></div>
                      <div className="col-span-7 truncate text-slate-600 sm:col-span-4">{c.category}</div>
                      <div className="col-span-5 flex items-center justify-end gap-3 sm:col-span-4"><StatusChip status={c.status} /><span className="hidden text-xs text-slate-400 xl:inline">{fmtDate(c.received_on)}</span></div>
                    </li>))}
                </ul>
              </Card>)
          })}
          {items.length === 0 && (
            <Card><EmptyState icon={CheckCircle2} title={needle ? 'Nothing matches that search' : 'No overlaps need coordination'}>
              {needle ? 'Try a different institution name or case number.' : 'No two Bureaus are working on the same institution at the moment. New overlaps appear here and in your alerts as soon as they are detected.'}</EmptyState></Card>)}
        </div>)}

      {open && drawerCluster && <ClusterDrawer cluster={drawerCluster} onClose={() => setSp({})} />}
    </div>
  )
}
