import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, FileSpreadsheet, FolderSearch, GitMerge, ListFilter, Search, Sparkles, X } from 'lucide-react'
import { api, download, useApi, useRole } from '../api'
import { BureauBadge, Card, EmptyState, ErrorBox, Loading, PageHeader, Segmented, SlaChip, StatusChip, ago, cx, dueText, fmtDate, fmtTs } from '../ui'

const FILTERS = ['q', 'bureau', 'region', 'category', 'status', 'overdue', 'overlap', 'nearing', 'age_gt', 'age_lt', 'date_from', 'date_to', 'institution_id', 'sort']
const filterLabel = (k: string, v: string) => ({
  overdue: 'Past due date', overlap: 'In an overlap', nearing: 'Due soon', age_gt: `Older than ${v} days`,
  age_lt: `Received in last ${v} days`, date_from: `Received from ${v}`, date_to: `Received until ${v}`,
  bureau: `Bureau ${v}`, status: v === 'Pending' ? 'Not yet closed' : `Status: ${v}`, q: `“${v}”`, region: `${v} region`, category: v,
} as any)[k] || `${k.replace('_', ' ')}: ${v}`
const NL_EXAMPLES = ['pending RB cases in Western region older than 30 days', 'overdue PGRC cases in south western region', 'escalated faculty complaints', 'ragging complaints in Bhopal']
const SORTS = [['received_desc', 'Newest first'], ['received_asc', 'Oldest first'], ['due_asc', 'Due soonest'], ['due_desc', 'Due latest'], ['severity_desc', 'Most serious'], ['severity_asc', 'Least serious']]

function Field({ label, children }: { label: string; children: any }) {
  return <label className="block"><span className="eyebrow mb-1 block">{label}</span>{children}</label>
}
function Select({ label, value, onChange, options, all = 'All' }: any) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="field">
        <option value="">{all}</option>
        {options.map((o: any) => <option key={o.v ?? o} value={o.v ?? o}>{o.l ?? o}</option>)}
      </select>
    </Field>
  )
}

function SortTh({ label, sortKey, currentSort, onSort, className = '' }: { label: string; sortKey: string; currentSort: string; onSort: (key: string) => void; className?: string }) {
  const isDesc = currentSort === `${sortKey}_desc`
  const isAsc = currentSort === `${sortKey}_asc`
  const active = isDesc || isAsc
  const ariaSort = isAsc ? 'ascending' : isDesc ? 'descending' : 'none'
  const handleClick = () => {
    if (sortKey === 'due') onSort(currentSort === 'due_asc' ? 'due_desc' : 'due_asc')
    else onSort(isDesc ? `${sortKey}_asc` : `${sortKey}_desc`)
  }
  return (
    <th scope="col" aria-sort={ariaSort} className={cx('px-4 py-2.5', className)}>
      <button type="button" onClick={handleClick}
        className={cx('eyebrow inline-flex items-center gap-1 transition hover:text-slate-800', active && '!text-navy-2')}>
        <span>{label}</span>
        {isAsc ? <ArrowUp size={12} /> : isDesc ? <ArrowDown size={12} /> : <ArrowUpDown size={12} className="opacity-40" />}
      </button>
    </th>
  )
}

/** Severity at a glance: five pips instead of "4 / 5". */
function Severity({ n }: { n: number }) {
  const color = n >= 4 ? '#ec4658' : n === 3 ? '#ff8a1f' : '#8792b8'
  return (
    <span className="inline-flex items-center gap-[3px]" title={`Severity ${n} of 5`} aria-label={`Severity ${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className="h-2.5 w-1 rounded-[1px]" style={{ background: i <= n ? color : 'var(--color-slate-200)' }} />)}
    </span>
  )
}

function OverlapMark({ c }: { c: any }) {
  if (!c.overlap || c.overlap.status === 'RESOLVED' || c.overlap.status === 'DISMISSED') return null
  return (
    <Link to={`/overlaps?open=${c.overlap.cluster_id}`} onClick={(e) => e.stopPropagation()} title="Potential overlap with other Bureaus"
      className="inline-flex items-center gap-1 rounded-[4px] border border-indigo-200 bg-indigo-50 px-1 py-px text-[10.5px] font-bold uppercase tracking-wide text-indigo-700 hover:bg-indigo-100">
      <GitMerge size={11} /> Overlap
    </Link>
  )
}

export default function Cases() {
  const nav = useNavigate()
  const me = useRole()
  const isBureau = !['SENIOR', 'REGIONAL'].includes(me.role)
  const [sp, setSp] = useSearchParams()
  const [page, setPage] = useState(1)
  const [showFilters, setShowFilters] = useState(false)
  const meta = useApi<any>('/meta', false)
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp)
    v ? n.set(k, v) : n.delete(k)
    setSp(n, { replace: true }); setPage(1)
  }
  const [qLocal, setQLocal] = useState(sp.get('q') || '')
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
  function submitSearch(raw: string) {
    const t = raw.trim()
    if (!t) { set('q', ''); setNl(null); return }
    if (t.split(/\s+/).length >= 3 && !/^[\w/-]+$/.test(t)) runNl(t)
    else { setNl(null); const n = new URLSearchParams(sp); n.delete('nl'); n.set('q', t); setSp(n, { replace: true }); setPage(1) }
  }
  useEffect(() => { const t = sp.get('nl'); if (t) { setQLocal(t); runNl(t) } }, [sp.get('nl')])
  useEffect(() => { if (!sp.get('nl')) setQLocal(sp.get('q') || '') }, [sp.get('q')])
  // arriving at plain /cases as a Bureau officer: start with your own Bureau's cases
  useEffect(() => { if (isBureau && [...sp.keys()].length === 0) setSp(new URLSearchParams({ bureau: me.role }), { replace: true }) }, [])

  const qs = new URLSearchParams()
  FILTERS.forEach((k) => sp.get(k) && qs.set(k, sp.get(k)!))
  qs.set('page', String(page)); qs.set('page_size', '25')
  const { data, error, loading } = useApi<any>('/cases?' + qs.toString())
  const currentSort = sp.get('sort') || 'received_desc'
  const active = FILTERS.filter((k) => k !== 'sort' && sp.get(k))
  const m = meta.data
  const scope = sp.get('bureau') === me.role ? 'mine' : sp.get('bureau') ? 'other' : 'all'
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1
  const clearAll = () => { setSp(new URLSearchParams()); setPage(1); setNl(null); setQLocal('') }
  const toggles: [string, string][] = [['overdue', 'Past due date'], ['nearing', 'Due soon'], ['overlap', 'In an overlap']]

  return (
    <div className="mx-auto max-w-[1360px]">
      <PageHeader eyebrow="Every complaint" title="Cases"
        subtitle="Find any complaint, see who is handling it and what happens next."
        actions={<button className="btn btn-ghost" onClick={() => { const e = new URLSearchParams(sp); e.delete('nl'); download('/export/cases?' + e.toString(), 'aicte_cases.csv') }}>
          <FileSpreadsheet size={16} className="text-emerald-600" /> Download as spreadsheet</button>} />

      <div className="rise rise-1 space-y-3">
        <form onSubmit={(e) => { e.preventDefault(); submitSearch(qLocal) }} className="flex gap-2">
          <label className="relative block flex-1">
            <span className="sr-only">Search cases</span>
            <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={qLocal} onChange={(e) => setQLocal(e.target.value)}
              placeholder="Case number, institution, or ask: “pending RB cases in Western region older than 30 days”"
              className="field !rounded-full !py-3 !pl-11 !pr-4 shadow-sm" />
          </label>
          <button className="btn btn-primary !rounded-full px-6" disabled={nlBusy}>Search</button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          {isBureau && (
            <Segmented label="Whose cases" value={scope === 'mine' ? 'mine' : 'all'} onChange={(v) => set('bureau', v === 'mine' ? me.role : '')}
              options={[['mine', `My Bureau (${me.role})`], ['all', 'All Bureaus']] as const} />)}
          {toggles.map(([k, l]) => (
            <button key={k} aria-pressed={!!sp.get(k)} onClick={() => set(k, sp.get(k) ? '' : '1')}
              className={cx('rounded-full border px-3.5 py-1.5 text-sm font-semibold transition',
                sp.get(k) ? (k === 'overdue' ? 'border-red-300 bg-red-50 text-red-700' : k === 'overlap' ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-orange-300 bg-orange-50 text-orange-700')
                  : 'border-line bg-sheet text-slate-600 hover:border-slate-300 hover:text-slate-900')}>{l}</button>))}
          <button onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}
            className={cx('ml-auto flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition', showFilters ? 'border-navy bg-navy text-white' : 'border-line bg-sheet text-slate-600 hover:border-slate-300')}>
            <ListFilter size={15} /> More filters
          </button>
        </div>

        {showFilters && (
          <Card className="toast-in">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
              <Select label="Bureau / Cell" value={sp.get('bureau') || ''} onChange={(v: string) => set('bureau', v)} options={(m?.bureaus || []).map((b: any) => ({ v: b.code, l: `${b.code} — ${b.name}` }))} />
              <Select label="Region" value={sp.get('region') || ''} onChange={(v: string) => set('region', v)} options={(m?.regions || []).map((r: any) => r.name)} />
              <Select label="Category" value={sp.get('category') || ''} onChange={(v: string) => set('category', v)} options={(m?.categories || []).map((c: any) => c.name)} />
              <Select label="Status" value={sp.get('status') || ''} onChange={(v: string) => set('status', v)} options={[{ v: 'Pending', l: 'Not yet closed' }, ...(m?.statuses || [])]} />
              <Field label="Received from"><input type="date" value={sp.get('date_from') || ''} onChange={(e) => set('date_from', e.target.value)} className="field" /></Field>
              <Field label="Received to"><input type="date" value={sp.get('date_to') || ''} onChange={(e) => set('date_to', e.target.value)} className="field" /></Field>
            </div>
          </Card>)}

        {(active.length > 0 || nl) && (
          <div className="flex flex-wrap items-center gap-2">
            {nl && (
              <span className="flex items-center gap-1.5 text-[13px] text-slate-600"><Sparkles size={14} className="text-saffron" />
                {nl.understood ? <>I understood: {nl.chips.map((c: any, i: number) => <span key={i} className="ml-1 rounded-full bg-navy px-2.5 py-0.5 text-xs font-semibold text-white">{c.label}</span>)}</> : 'I could not pick out anything specific, so these are keyword matches.'}</span>)}
            {!nl && active.map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-sheet py-1 pl-3 pr-1.5 text-[13px] font-medium text-slate-700">
                {filterLabel(k, sp.get(k)!)}<button onClick={() => set(k, '')} aria-label={`Remove filter ${k}`} className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-800"><X size={12} /></button></span>))}
            <button className="text-[13px] font-semibold text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline" onClick={clearAll}>Clear everything</button>
          </div>)}
        {!nl && active.length === 0 && (
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-500">
            <Sparkles size={14} className="text-saffron" /> Try asking:
            {NL_EXAMPLES.map((e) => <button key={e} onClick={() => { setQLocal(e); runNl(e) }} className="rounded-full border border-line bg-sheet px-2.5 py-1 text-slate-600 transition hover:border-slate-300 hover:text-slate-900">{e}</button>)}
          </div>)}
      </div>

      <Card pad={false} className="rise rise-2 mt-5 overflow-hidden">
        {loading && !data ? <div className="p-5"><Loading /></div> : error && !data ? <ErrorBox msg={error} /> : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
              <span className="text-[14px] text-slate-600"><b className="font-display num text-xl font-semibold text-slate-900">{data.total}</b> {data.total === 1 ? 'case' : 'cases'}</span>
              <label className="flex items-center gap-2 text-[13px] text-slate-500">Sort by
                <select value={currentSort} onChange={(e) => set('sort', e.target.value === 'received_desc' ? '' : e.target.value)} className="field !w-auto !py-1.5 !text-[13px]">
                  {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></label>
            </div>

            {data.items.length === 0 ? (
              <EmptyState icon={FolderSearch} title="No cases match" action={<button className="btn btn-ghost" onClick={clearAll}>Clear the search and filters</button>}>
                Try fewer filters, or check the spelling of the institution.</EmptyState>
            ) : (<>
              {/* phones and small tablets: one card per case */}
              <ul className="divide-y divide-line md:hidden">
                {data.items.map((c: any) => (
                  <li key={c.case_id}>
                    <Link to={`/cases/${c.case_id}`} className="block px-4 py-3.5 active:bg-slate-100">
                      <div className="flex items-center gap-2"><span className="case-id text-navy-2">{c.case_id}</span><StatusChip status={c.status} /><span className="ml-auto text-xs font-semibold text-slate-500 num">{dueText(c.sla)}</span></div>
                      <div className="mt-1 font-medium text-slate-900">{c.institution.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-slate-500"><BureauBadge code={c.bureau} />{c.category}<OverlapMark c={c} /></div>
                      <div className="mt-1 text-[13px] text-slate-500">Next: {c.next_action || '—'}</div>
                    </Link>
                  </li>))}
              </ul>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100/60 text-left">
                    <tr>
                      <th scope="col" className="eyebrow px-5 py-2.5">Case</th>
                      <th scope="col" className="eyebrow px-4 py-2.5">Institution and complaint</th>
                      <th scope="col" className="eyebrow px-4 py-2.5">Handled by</th>
                      <th scope="col" className="eyebrow px-4 py-2.5">Status</th>
                      <SortTh label="Time left" sortKey="due" currentSort={currentSort} onSort={(s) => set('sort', s)} />
                      <th scope="col" className="eyebrow hidden px-4 py-2.5 2xl:table-cell">What happens next</th>
                      <SortTh label="Received" sortKey="received" currentSort={currentSort} onSort={(s) => set('sort', s)} className="hidden 2xl:table-cell" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.items.map((c: any) => (
                      <tr key={c.case_id} onClick={() => nav(`/cases/${c.case_id}`)} className="group cursor-pointer align-top transition hover:bg-slate-50">
                        <td className="whitespace-nowrap px-5 py-3.5">
                          <Link to={`/cases/${c.case_id}`} onClick={(e) => e.stopPropagation()} className="case-id text-navy-2 group-hover:underline">{c.case_id}</Link>
                          <div className="mt-1.5 flex items-center gap-2"><Severity n={c.severity} /><span className="text-[11px] text-slate-400">{c.reference_no}</span></div>
                        </td>
                        <td className="max-w-[300px] px-4 py-3.5">
                          <Link to={`/institutions/${c.institution.aicte_id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-medium text-slate-900 hover:underline">{c.institution.name}</Link>
                          <div className="mt-0.5 truncate text-[13px] text-slate-500">{c.category} · {c.institution.region}</div>
                          <div className="mt-0.5 truncate text-[12.5px] text-slate-400 2xl:hidden" title={c.next_action || ''}>Next: {c.next_action || '—'}</div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5">
                          <div className="flex items-center gap-1.5"><BureauBadge code={c.bureau} /><OverlapMark c={c} /></div>
                          <div className="mt-1 text-[13px] text-slate-500">{c.assigned_officer.name}</div>
                        </td>
                        <td className="px-4 py-3.5"><StatusChip status={c.status} /></td>
                        <td className="px-4 py-3.5"><SlaChip sla={c.sla} /></td>
                        <td className="hidden max-w-[230px] px-4 py-3.5 2xl:table-cell">
                          <div className="truncate text-slate-800" title={c.next_action || '—'}>{c.next_action || '—'}</div>
                          <div className="mt-0.5 truncate text-[12px] text-slate-400" title={c.last_action_at ? fmtTs(c.last_action_at) : ''}>Last: {c.last_action || '—'}{c.last_action_at ? ` · ${ago(c.last_action_at)}` : ''}</div>
                        </td>
                        <td className="hidden whitespace-nowrap px-4 py-3.5 text-[13px] text-slate-500 2xl:table-cell">{fmtDate(c.received_on)}</td>
                      </tr>))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-[13px] text-slate-500">
                <span>Showing <span className="num">{(data.page - 1) * data.page_size + 1}–{Math.min(data.total, data.page * data.page_size)}</span> of <span className="num">{data.total}</span></span>
                <div className="flex items-center gap-2">
                  <button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page" className="btn btn-ghost btn-sm !px-2"><ChevronLeft size={16} /></button>
                  <span className="num">Page {data.page} of {pages}</span>
                  <button disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page" className="btn btn-ghost btn-sm !px-2"><ChevronRight size={16} /></button>
                </div>
              </div>
            </>)}
          </>)}
      </Card>
    </div>
  )
}
