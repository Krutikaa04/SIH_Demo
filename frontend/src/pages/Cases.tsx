import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, FileSpreadsheet, GitMerge, Sparkles, X } from 'lucide-react'
import { api, download, useApi } from '../api'
import { BureauBadge, Card, ErrorBox, Loading, SlaChip, StatusChip, ago, cx, fmtDate, fmtTs } from '../ui'

const FILTERS = ['q', 'bureau', 'region', 'category', 'status', 'overdue', 'overlap', 'nearing', 'age_gt', 'age_lt', 'date_from', 'date_to', 'institution_id', 'sort']
const filterLabel = (k: string, v: string) => ({
  overdue: 'Beyond timeline', overlap: 'In an overlap', nearing: 'Nearing timeline', age_gt: `Older than ${v} days`,
  age_lt: `Received in last ${v} days`, date_from: `Received from ${v}`, date_to: `Received until ${v}`,
} as any)[k] || `${k.replace('_', ' ')}: ${v}`
const NL_EXAMPLES = ['pending RB cases in Western region older than 30 days', 'overdue PGRC cases in south western region', 'escalated faculty complaints', 'ragging complaints in Bhopal']

function Select({ label, value, onChange, options }: any) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm outline-none focus:border-navy-2">
        <option value="">All</option>
        {options.map((o: any) => <option key={o.v ?? o} value={o.v ?? o}>{o.l ?? o}</option>)}
      </select>
    </label>
  )
}

function SortTh({ label, sortKey, currentSort, onSort, className = '' }: { label: string; sortKey: string; currentSort: string; onSort: (key: string) => void; className?: string }) {
  const isDesc = currentSort === `${sortKey}_desc`
  const isAsc = currentSort === `${sortKey}_asc`
  const active = isDesc || isAsc
  const ariaSort = isAsc ? 'ascending' : isDesc ? 'descending' : 'none'

  const handleClick = () => {
    if (sortKey === 'due') {
      onSort(currentSort === 'due_asc' ? 'due_desc' : 'due_asc')
    } else {
      onSort(isDesc ? `${sortKey}_asc` : `${sortKey}_desc`)
    }
  }

  return (
    <th scope="col" aria-sort={ariaSort} className={cx('px-4 py-2.5 font-medium', className)}>
      <button type="button" onClick={handleClick}
        className={cx('inline-flex items-center gap-1 uppercase tracking-wider text-[11px] transition hover:text-slate-700',
          active ? 'font-bold text-navy-2' : 'text-slate-400')}>
        <span>{label}</span>
        {isAsc ? <ArrowUp size={12} className="text-navy-2" /> : isDesc ? <ArrowDown size={12} className="text-navy-2" /> : <ArrowUpDown size={12} className="opacity-40" />}
      </button>
    </th>
  )
}

export default function Cases() {
  const [sp, setSp] = useSearchParams()
  const [page, setPage] = useState(1)
  const meta = useApi<any>('/meta', false)
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp)
    v ? n.set(k, v) : n.delete(k)
    setSp(n, { replace: true }); setPage(1)
  }
  const [qLocal, setQLocal] = useState(sp.get('q') || '')
  const [nlText, setNlText] = useState(sp.get('nl') || '')
  const [nl, setNl] = useState<any>(null)
  const [nlBusy, setNlBusy] = useState(false)
  async function runNl(text: string) {
    if (!text.trim()) return
    setNlBusy(true)
    try {
      const r = await api('/search/nl?q=' + encodeURIComponent(text))
      setNl(r)
      const n = new URLSearchParams()
      Object.entries(r.params).forEach(([k, v]) => n.set(k, String(v)))
      setSp(n, { replace: true }); setPage(1)
    } finally { setNlBusy(false) }
  }
  useEffect(() => { const t = sp.get('nl'); if (t) { setNlText(t); runNl(t) } }, [sp.get('nl')])
  useEffect(() => setQLocal(sp.get('q') || ''), [sp.get('q')])
  const qs = new URLSearchParams()
  FILTERS.forEach((k) => sp.get(k) && qs.set(k, sp.get(k)!))
  qs.set('page', String(page)); qs.set('page_size', '25')
  const { data, error, loading } = useApi<any>('/cases?' + qs.toString())
  const currentSort = sp.get('sort') || 'received_desc'
  const active = FILTERS.filter((k) => k !== 'sort' && sp.get(k))
  const m = meta.data

  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Cases</h1>
        <p className="text-sm text-slate-500">Every complaint across all Bureaus and Cells, with the Bureau currently handling it.</p>
      </div>

      <div className="rounded-xl bg-gradient-to-r from-navy to-navy-2 p-4 shadow-sm">
        <form onSubmit={(e) => { e.preventDefault(); runNl(nlText) }} className="flex gap-2">
          <div className="relative flex-1">
            <Sparkles size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-amber-500" />
            <input value={nlText} onChange={(e) => setNlText(e.target.value)} placeholder="Ask in plain English — e.g. pending RB cases in Western region older than 30 days"
              className="w-full rounded-lg bg-white py-3 pl-10 pr-3 text-sm outline-none ring-2 ring-transparent focus:ring-amber-400" />
          </div>
          <button disabled={nlBusy} className="rounded-lg bg-saffron px-5 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-60">Search</button>
        </form>
        {nl ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-slate-300">I understood:</span>
            {nl.chips.map((c: any, i: number) => <span key={i} className="rounded-full bg-white/15 px-2.5 py-1 font-medium text-white ring-1 ring-white/20">{c.label}</span>)}
            {!nl.understood && <span className="text-slate-300">nothing specific — showing keyword matches</span>}
            <span className="ml-auto text-[11px] text-slate-400">rule-based parser · runs offline</span>
          </div>) : (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-300">Try:
            {NL_EXAMPLES.map((e) => <button key={e} onClick={() => { setNlText(e); runNl(e) }} className="rounded-full bg-white/10 px-2.5 py-1 hover:bg-white/20">{e}</button>)}</div>)}
      </div>

      <Card>
        <form className="mb-3" onSubmit={(e) => { e.preventDefault(); set('q', qLocal) }}>
          <input value={qLocal} onChange={(e) => setQLocal(e.target.value)} placeholder="Search by institution name, AICTE ID, case ID or text — press Enter"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-navy-2 focus:bg-white" />
        </form>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <Select label="Bureau / Cell" value={sp.get('bureau') || ''} onChange={(v: string) => set('bureau', v)} options={(m?.bureaus || []).map((b: any) => ({ v: b.code, l: `${b.code} — ${b.name}` }))} />
          <Select label="Region" value={sp.get('region') || ''} onChange={(v: string) => set('region', v)} options={(m?.regions || []).map((r: any) => r.name)} />
          <Select label="Category" value={sp.get('category') || ''} onChange={(v: string) => set('category', v)} options={(m?.categories || []).map((c: any) => c.name)} />
          <Select label="Status" value={sp.get('status') || ''} onChange={(v: string) => set('status', v)} options={['Pending', ...(m?.statuses || [])]} />
          <label className="block"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Received from</span>
            <input type="date" value={sp.get('date_from') || ''} onChange={(e) => set('date_from', e.target.value)} className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" /></label>
          <label className="block"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Received to</span>
            <input type="date" value={sp.get('date_to') || ''} onChange={(e) => set('date_to', e.target.value)} className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" /></label>
          <div className="flex items-end gap-2">
            {[['overdue', 'Overdue'], ['overlap', 'Overlap']].map(([k, l]) => (
              <button key={k} onClick={() => set(k, sp.get(k) ? '' : '1')}
                className={cx('rounded-lg border px-3 py-2 text-sm font-medium transition', sp.get(k) ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>{l}</button>))}
          </div>
        </div>
        {active.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {active.map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5 rounded-full bg-navy/8 px-2.5 py-1 text-xs font-medium text-navy">
                {filterLabel(k, sp.get(k)!)}<button onClick={() => set(k, '')}><X size={12} /></button></span>))}
            <button className="text-xs text-slate-500 underline" onClick={() => { setSp(new URLSearchParams()); setPage(1); setNl(null); setNlText('') }}>Clear all</button>
          </div>)}
      </Card>

      <Card pad={false}>
        {loading && !data ? <Loading /> : error && !data ? <ErrorBox msg={error} /> : (
          <>
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 text-sm text-slate-500">
              <span className="flex items-center gap-3"><span><b className="num text-slate-800">{data.total}</b> cases</span>
                <button onClick={() => { const e = new URLSearchParams(sp); e.delete('nl'); download('/export/cases?' + e.toString(), 'aicte_cases.csv') }}
                  className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"><FileSpreadsheet size={13} className="text-emerald-600" /> Export CSV</button></span>
              <div className="flex items-center gap-2">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-md border border-slate-200 p-1 disabled:opacity-30"><ChevronLeft size={16} /></button>
                <span className="num text-xs">Page {data.page} / {Math.max(1, Math.ceil(data.total / data.page_size))}</span>
                <button disabled={page * data.page_size >= data.total} onClick={() => setPage(page + 1)} className="rounded-md border border-slate-200 p-1 disabled:opacity-30"><ChevronRight size={16} /></button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-medium">Case ID</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Institution</th>
                    <th scope="col" className="hidden sm:table-cell px-4 py-2.5 font-medium">Category</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Handled by</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                    <th scope="col" className="hidden xl:table-cell px-4 py-2.5 font-medium">Officer</th>
                    <th scope="col" className="hidden md:table-cell px-4 py-2.5 font-medium">Last action</th>
                    <th scope="col" className="hidden lg:table-cell px-4 py-2.5 font-medium">Next action</th>
                    <SortTh label="Timeline" sortKey="due" currentSort={currentSort} onSort={(s) => set('sort', s)} />
                    <SortTh label="Received" sortKey="received" currentSort={currentSort} onSort={(s) => set('sort', s)} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((c: any) => (
                    <tr key={c.case_id} className="hover:bg-slate-50/70">
                      <td className="whitespace-nowrap px-4 py-3">
                        <Link to={`/cases/${c.case_id}`} className="font-semibold text-navy-2 hover:underline">{c.case_id}</Link>
                        <div className="num text-[11px] text-slate-400">{c.reference_no}</div>
                      </td>
                      <td className="max-w-[260px] px-4 py-3">
                        <Link to={`/institutions/${c.institution.aicte_id}`} className="block truncate font-medium text-slate-800 hover:underline">{c.institution.name}</Link>
                        <div className="text-xs text-slate-400">{c.institution.region} · <span className="num">{c.institution.aicte_id}</span></div>
                      </td>
                      <td className="hidden sm:table-cell px-4 py-3 text-slate-600">{c.category}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-1.5"><BureauBadge code={c.bureau} />
                          {c.overlap && c.overlap.status !== 'RESOLVED' && c.overlap.status !== 'DISMISSED' && (
                            <Link to={`/overlaps?open=${c.overlap.cluster_id}`} title="Potential overlap with other Bureaus" className="rounded-md bg-red-50 p-1 text-red-600 hover:bg-red-100"><GitMerge size={13} /></Link>)}
                        </div>
                      </td>
                      <td className="px-4 py-3"><StatusChip status={c.status} /></td>
                      <td className="hidden xl:table-cell whitespace-nowrap px-4 py-3 text-slate-600">{c.assigned_officer.name}</td>
                      <td className="hidden md:table-cell max-w-[200px] px-4 py-3">
                        <div className="truncate font-medium text-slate-700" title={c.last_action || '—'}>{c.last_action || '—'}</div>
                        {c.last_action_at && (
                          <div className="text-[11px] text-slate-400" title={fmtTs(c.last_action_at)}>{ago(c.last_action_at)}</div>
                        )}
                      </td>
                      <td className="hidden lg:table-cell max-w-[180px] px-4 py-3">
                        <div className="truncate text-slate-600" title={c.next_action || '—'}>{c.next_action || '—'}</div>
                      </td>
                      <td className="px-4 py-3"><SlaChip sla={c.sla} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fmtDate(c.received_on)}</td>
                    </tr>))}
                  {data.items.length === 0 && <tr><td colSpan={10} className="p-10 text-center text-slate-400">No cases match these filters.</td></tr>}
                </tbody>
              </table>
            </div>
          </>)}
      </Card>
    </div>
  )
}
