import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Inbox, Search, Trash2 } from 'lucide-react'
import { api, post, useApi } from '../api'
import { BureauBadge, Card, ErrorBox, Loading, cx, fmtDate, fmtTs } from '../ui'

const TABS = [['OPEN', 'Waiting'], ['RESOLVED', 'Resolved'], ['DISCARDED', 'Discarded']] as const

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
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-slate-400">{it.id}</span>
        <BureauBadge code={it.bureau} />
        <span className="text-[15px] font-semibold text-slate-900">“{it.institution_name}”</span>
        {it.aicte_id && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] num text-slate-600">ID {it.aicte_id}</span>}
        <span className="ml-auto text-xs text-slate-400">parked by {it.created_by} · {fmtTs(it.created_at)}</span>
      </div>
      <div className="mt-1 text-xs text-slate-500">{c.category} · severity {c.severity}/5 · via {c.source} · received {fmtDate(c.received_on)}</div>
      <p className="mt-2 text-sm leading-relaxed text-slate-700">{c.description}</p>

      {it.status === 'RESOLVED' && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 size={16} /> Matched by {it.resolved_by} → <Link className="font-semibold underline" to={`/cases/${it.resolved_case_id}`}>{it.resolved_case_id}</Link>
          <span className="ml-auto text-xs text-emerald-700/80">{fmtTs(it.resolved_at)}</span></div>)}
      {it.status === 'DISCARDED' && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          <b>Discarded by {it.resolved_by}</b> · {fmtTs(it.resolved_at)}<div className="mt-0.5">Reason: {it.discard_reason}</div></div>)}

      {it.status === 'OPEN' && (
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Closest institutions</div>
            {it.suggestions.length === 0 && <p className="text-sm text-slate-400">No similar names in the master list. Search below.</p>}
            <ul className="space-y-1.5">
              {it.suggestions.map((s: any) => (
                <li key={s.institution_id}>
                  <button onClick={() => setPick({ id: s.institution_id, name: s.name })}
                    className={cx('flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm',
                      pick?.id === s.institution_id ? 'border-navy bg-navy/5 ring-1 ring-navy' : 'border-slate-200 hover:bg-slate-50')}>
                    <span><span className="font-medium">{s.name}</span><span className="ml-2 text-xs text-slate-400">{s.region}</span></span>
                    <span className="num text-xs text-slate-500">{s.score}%</span></button></li>))}
            </ul>
          </div>
          <div>
            <div className="relative"><Search size={14} className="absolute left-3 top-3 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the master list by name, city or ID…"
                className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-navy-2" /></div>
            {q.trim().length >= 2 && (
              <ul className="mt-1.5 max-h-40 space-y-1 overflow-auto">
                {(found.data?.items || []).slice(0, 8).map((s: any) => (
                  <li key={s.aicte_id}><button onClick={() => { setPick({ id: s.aicte_id, name: s.name }); setQ('') }}
                    className="w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-slate-100">{s.name} <span className="text-xs text-slate-400">{s.aicte_id}</span></button></li>))}
              </ul>)}
          </div>
          {err && <div className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{err}</div>}
          {discarding ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-2.5">
              <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Reason for discarding (required, kept as an audit record)"
                className="min-w-0 flex-1 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-sm outline-none" />
              <button disabled={!why.trim() || busy} onClick={discard} className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40">Discard</button>
              <button onClick={() => setDiscarding(false)} className="rounded-md px-2 py-1.5 text-sm text-slate-500 hover:bg-white">Cancel</button>
            </div>) : (
            <div className="flex flex-wrap gap-2">
              <button disabled={!pick || busy} onClick={resolve}
                className="rounded-lg bg-saffron px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40">
                {busy ? 'Registering…' : pick ? `Register under ${pick.name}` : 'Pick an institution to register'}</button>
              <button onClick={() => setDiscarding(true)} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><Trash2 size={14} /> Discard…</button>
            </div>)}
        </div>)}

    </Card>
  )
}

export default function Unmatched() {
  const [tab, setTab] = useState<'OPEN' | 'RESOLVED' | 'DISCARDED'>('OPEN')
  const { data, error, loading, reload } = useApi<any>(`/unmatched?status=${tab}`)
  const [recent, setRecent] = useState<any[]>([])
  return (
    <div className="mx-auto max-w-[900px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Review queue</h1>
          <p className="text-sm text-slate-500">Complaints whose institution could not be matched with confidence. Pick the right institution to register them, or discard with a reason.</p>
        </div>
        <div className="flex rounded-lg bg-slate-200/70 p-1 text-sm">
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={cx('rounded-md px-3 py-1.5 font-medium', tab === k ? 'bg-white shadow-sm' : 'text-slate-500')}>
              {l}{data?.counts ? ` · ${data.counts[k]}` : ''}</button>))}
        </div>
      </div>
      {loading && !data ? <Loading /> : error && !data ? <ErrorBox msg={error} /> : (
        <div className="space-y-4">
          {tab === 'OPEN' && recent.map((r) => (
            <div key={r.id} className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-800">
              <div className="flex items-center gap-2 font-semibold"><CheckCircle2 size={16} /> “{r.name}” registered as <Link className="underline" to={`/cases/${r.case.case_id}`}>{r.case.case_id}</Link>
                <button onClick={() => setRecent((x) => x.filter((y) => y.id !== r.id))} className="ml-auto text-xs font-medium text-emerald-700 hover:underline">Dismiss</button></div>
              {r.overlaps?.length > 0 && <div className="mt-1 text-red-700">Potential overlap detected — <Link className="font-semibold underline" to={`/overlaps?open=${r.overlaps[0].cluster_id}`}>review and coordinate</Link></div>}
            </div>))}
          {data.items.map((it: any) => <Item key={it.id} it={it} onChanged={reload} onResolved={(r) => setRecent((x) => [r, ...x])} />)}
          {data.items.length === 0 && (
            <Card><div className="flex flex-col items-center gap-2 p-8 text-center text-slate-400">
              <Inbox size={28} />
              {tab === 'OPEN' ? 'Nothing is waiting. Complaints saved for review from Register complaint appear here.' : `No ${tab.toLowerCase()} items.`}
            </div></Card>)}
        </div>)}
    </div>
  )
}
