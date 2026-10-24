import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Inbox, Search, Trash2 } from 'lucide-react'
import { api, post, useApi } from '../api'
import { BureauBadge, Card, EmptyState, ErrorBox, Loading, PageHeader, Segmented, cx, fmtDate, fmtTs } from '../ui'

function Item({ it, onChanged, onResolved }: { it: any; onChanged: () => void; onResolved: (r: any) => void }) {
  const [pick, setPick] = useState<{ id: string; name: string } | null>(null)
  const [q, setQ] = useState('')
  const [why, setWhy] = useState('')
  const [discarding, setDiscarding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const found = useApi<any>(it.status === 'OPEN' && q.trim().length >= 2 ? `/institutions?q=${encodeURIComponent(q)}` : null, false)
  const c = it.complaint

  async function resolve() {
    if (!pick) return
    setBusy(true); setErr('')
    try { onResolved({ id: it.id, name: it.institution_name, ...(await post(`/unmatched/${it.id}/resolve`, { institution_id: pick.id })) }); onChanged() }
    catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  async function discard() {
    setBusy(true); setErr('')
    try { await api(`/unmatched/${it.id}?reason=${encodeURIComponent(why)}`, { method: 'DELETE' }); onChanged() }
    catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Card className="rise">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-xs text-slate-400">{it.id}</span>
        <BureauBadge code={it.bureau} />
        <span className="text-[12.5px] text-slate-500">saved by {it.created_by} · {fmtTs(it.created_at)}</span>
      </div>
      <h3 className="font-display mt-2 text-[1.3125rem] font-semibold leading-snug text-slate-900">“{it.institution_name}”</h3>
      <div className="mt-0.5 text-[13px] text-slate-500">{c.category} · seriousness {c.severity} of 5 · via {c.source} · received {fmtDate(c.received_on)}{it.aicte_id && <> · quoted ID <span className="num">{it.aicte_id}</span></>}</div>
      <blockquote className="font-display mt-3 border-l-2 border-saffron pl-4 text-[1.0625rem] leading-relaxed text-slate-800">{c.description}</blockquote>

      {it.status === 'RESOLVED' && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <CheckCircle2 size={16} /> Matched by {it.resolved_by}, now <Link className="case-id underline" to={`/cases/${it.resolved_case_id}`}>{it.resolved_case_id}</Link>
          <span className="ml-auto text-xs text-emerald-700/80">{fmtTs(it.resolved_at)}</span></div>)}
      {it.status === 'DISCARDED' && (
        <div className="mt-4 rounded-lg border border-line bg-slate-100/70 p-3 text-sm text-slate-600">
          <b className="text-slate-800">Set aside by {it.resolved_by}</b> · {fmtTs(it.resolved_at)}<div className="mt-0.5">Reason: {it.discard_reason}</div></div>)}

      {it.status === 'OPEN' && (
        <div className="mt-5 space-y-4 border-t border-line pt-4">
          <div>
            <div className="eyebrow mb-2">Closest institutions</div>
            {it.suggestions.length === 0 && <p className="text-sm text-slate-400">Nothing similar in the list. Search below.</p>}
            <ul className="space-y-1.5">
              {it.suggestions.map((s: any) => (
                <li key={s.institution_id}>
                  <button onClick={() => setPick({ id: s.institution_id, name: s.name })} aria-pressed={pick?.id === s.institution_id}
                    className={cx('flex w-full items-center justify-between rounded-lg border px-3.5 py-2.5 text-left text-sm transition',
                      pick?.id === s.institution_id ? 'border-navy bg-navy/[.04] ring-2 ring-navy' : 'border-line bg-white hover:border-slate-400')}>
                    <span><span className="font-medium">{s.name}</span><span className="ml-2 text-xs text-slate-400">{s.region}</span></span>
                    <span className="num text-xs text-slate-500">{s.score}% alike</span></button></li>))}
            </ul>
          </div>
          <div>
            <label className="relative block"><span className="sr-only">Search all institutions</span>
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Or search the full list by name, city or ID…" className="field !pl-10" /></label>
            {q.trim().length >= 2 && (
              <ul className="mt-1.5 max-h-44 space-y-0.5 overflow-auto rounded-lg border border-line bg-white p-1">
                {(found.data?.items || []).slice(0, 8).map((s: any) => (
                  <li key={s.aicte_id}><button onClick={() => { setPick({ id: s.aicte_id, name: s.name }); setQ('') }}
                    className="w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-slate-100">{s.name} <span className="text-xs text-slate-400">{s.aicte_id}</span></button></li>))}
              </ul>)}
          </div>
          {err && <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800" role="alert">{err}</div>}
          {discarding ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5">
              <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why is it being set aside? (required, kept on record)" className="field !w-auto min-w-0 flex-1 !py-2" />
              <button disabled={!why.trim() || busy} onClick={discard} className="btn btn-danger btn-sm">Set aside</button>
              <button onClick={() => setDiscarding(false)} className="btn btn-ghost btn-sm">Cancel</button>
            </div>) : (
            <div className="flex flex-wrap gap-2">
              <button disabled={!pick || busy} onClick={resolve} className="btn btn-accent">
                {busy ? 'Registering…' : pick ? `Register it under ${pick.name}` : 'Choose an institution first'}</button>
              <button onClick={() => setDiscarding(true)} className="btn btn-ghost"><Trash2 size={14} /> Set aside…</button>
            </div>)}
        </div>)}
    </Card>
  )
}

export default function Unmatched() {
  const [tab, setTab] = useState<'OPEN' | 'RESOLVED' | 'DISCARDED'>('OPEN')
  const { data, error, loading, reload } = useApi<any>(`/unmatched?status=${tab}`)
  const [recent, setRecent] = useState<any[]>([])
  const label = (k: 'OPEN' | 'RESOLVED' | 'DISCARDED', l: string) => <>{l}{data?.counts ? <span className="num ml-1.5 text-xs opacity-70">{data.counts[k]}</span> : null}</>
  return (
    <div className="mx-auto max-w-[860px]">
      <PageHeader eyebrow="More" title="Complaints to match"
        subtitle="These complaints named an institution we could not identify with confidence. Choose the right one and the complaint becomes a normal case, or set it aside with a reason."
        actions={<Segmented label="Show" value={tab} onChange={setTab} options={[['OPEN', label('OPEN', 'Waiting')], ['RESOLVED', label('RESOLVED', 'Matched')], ['DISCARDED', label('DISCARDED', 'Set aside')]] as const} />} />
      {loading && !data ? <Loading /> : error && !data ? <ErrorBox msg={error} /> : (
        <div className="space-y-5">
          {tab === 'OPEN' && recent.map((r) => (
            <div key={r.id} className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <div className="flex flex-wrap items-center gap-2 font-semibold"><CheckCircle2 size={16} /> “{r.name}” is now <Link className="case-id underline" to={`/cases/${r.case.case_id}`}>{r.case.case_id}</Link>
                <button onClick={() => setRecent((x) => x.filter((y) => y.id !== r.id))} className="ml-auto text-xs font-medium text-emerald-700 hover:underline">Dismiss</button></div>
              {r.overlaps?.length > 0 && <div className="mt-1 text-red-700">An overlap was found. <Link className="font-semibold underline" to={`/overlaps?open=${r.overlaps[0].cluster_id}`}>See why and coordinate</Link></div>}
            </div>))}
          {data.items.map((it: any) => <Item key={it.id} it={it} onChanged={reload} onResolved={(r) => setRecent((x) => [r, ...x])} />)}
          {data.items.length === 0 && (
            <Card><EmptyState icon={Inbox} title={tab === 'OPEN' ? 'Nothing is waiting' : 'Nothing here'}>
              {tab === 'OPEN' ? 'When someone adds a complaint and chooses “save it for someone to match”, it will appear here.' : 'No items in this group yet.'}</EmptyState></Card>)}
        </div>)}
    </div>
  )
}
