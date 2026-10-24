import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { FileDown, FileSpreadsheet, Calculator, Clock, Zap, TrendingUp, CheckCircle, X } from 'lucide-react'
import { download, useApi } from '../api'
import { exportReportPdf } from '../pdf'
import { Card, ErrorBox, Loading, PageHeader, RiskBadge, cx } from '../ui'

const PALETTE: Record<string, string> = {
  '#3b82f6': '#364f8f', '#dc2626': '#b93b1f', '#16a34a': '#2c7f59', '#1d4ed8': '#34508f', '#7c3aed': '#70509e', '#0d9488': '#1f7a6b',
  '#b45309': '#a8641a', '#be123c': '#b03a2e', '#22c55e': '#2c7f59', '#eab308': '#d9ad1c', '#f97316': '#d67a17', '#2563eb': '#364f8f',
}
const recolor = (c: string) => PALETTE[c] || c

const TABS = [
  ['bureau', 'Bureau / Cell-wise'], ['region', 'Region-wise'], ['institution', 'Institution-wise'],
  ['status', 'Status-wise'], ['ageing', 'Pending ageing'],
  ['disposal', 'Disposal rate'], ['overlaps', 'Overlapping cases'], ['periodic', 'Monthly / quarterly'],
  ['roi', 'Effort saved'],
]

function RoiCalculator() {
  const [complaintCount, setComplaintCount] = useState<number>(300)
  const [manualMins, setManualMins] = useState<number>(12)
  const [aiMins, setAiMins] = useState<number>(3)

  const n = complaintCount
  const pairwiseTotal = Math.round((n * (n - 1)) / 2)
  const manualHoursTotal = Math.round((pairwiseTotal * manualMins) / 60)

  // Estimated suggested candidate pairs (~10% candidate selection rate or based on heuristic filtering)
  const suggestedCandidates = Math.max(15, Math.round(n * 0.4))
  const aiHoursTotal = Math.round((suggestedCandidates * aiMins) / 60)
  const hoursSaved = Math.max(0, manualHoursTotal - aiHoursTotal)
  const speedup = aiHoursTotal > 0 ? (manualHoursTotal / aiHoursTotal).toFixed(1) : '100+'
  const manMonths = (hoursSaved / 160).toFixed(1) // 160 hrs per working month

  const chartData = [
    { name: 'Manual Pairwise Review', hours: manualHoursTotal, fill: '#b93b1f' },
    { name: 'AI Candidate Review', hours: aiHoursTotal, fill: '#247a88' },
  ]

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl bg-sheet p-4 shadow-sm border border-line">
          <div className="flex items-center gap-1.5 eyebrow">
            <Clock size={13} className="text-navy" /> Investigator Hours Saved
          </div>
          <div className="font-display num mt-1 text-[1.875rem] font-semibold text-emerald-600">
            {hoursSaved.toLocaleString()} hrs
          </div>
          <div className="mt-0.5 text-xs text-slate-500">~{manMonths} officer-months</div>
        </div>

        <div className="rounded-xl bg-sheet p-4 shadow-sm border border-line">
          <div className="flex items-center gap-1.5 eyebrow">
            <Zap size={13} className="text-amber-500" /> Review Speedup
          </div>
          <div className="font-display num mt-1 text-[1.875rem] font-semibold text-navy">
            {speedup}x
          </div>
          <div className="mt-0.5 text-xs text-slate-500">Acceleration factor</div>
        </div>

        <div className="rounded-xl bg-sheet p-4 shadow-sm border border-line">
          <div className="eyebrow">Pairwise Combinations</div>
          <div className="font-display num mt-1 text-[1.875rem] font-semibold text-slate-800">
            {pairwiseTotal.toLocaleString()}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">N × (N-1) / 2 comparisons</div>
        </div>

        <div className="rounded-xl bg-sheet p-4 shadow-sm border border-line">
          <div className="eyebrow">AI Candidates Evaluated</div>
          <div className="font-display num mt-1 text-[1.875rem] font-semibold text-cyan-600">
            {suggestedCandidates}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">Pre-filtered high overlaps</div>
        </div>
      </div>

      {/* Interactive Controls & Chart */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Interactive Volume Simulation" subtitle="Adjust parameters to simulate annual grievance intake">
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs font-semibold text-slate-700">
                <span>Total Complaints Filed (N):</span>
                <span className="num font-bold text-navy">{complaintCount} cases</span>
              </div>
              <input
                type="range"
                min={50}
                max={1500}
                step={25}
                value={complaintCount}
                onChange={(e) => setComplaintCount(Number(e.target.value))}
                className="mt-2 w-full cursor-pointer accent-navy"
              />
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>50 dockets</span>
                <span>500 dockets</span>
                <span>1,500 dockets</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <div>
                <label className="block text-xs font-medium text-slate-600">Manual review / pair:</label>
                <input
                  type="number"
                  min={5}
                  max={30}
                  value={manualMins}
                  onChange={(e) => setManualMins(Math.max(1, Number(e.target.value)))}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs font-semibold outline-none"
                />
                <span className="text-[10px] text-slate-400">Minutes per dossier</span>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">AI review / candidate:</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={aiMins}
                  onChange={(e) => setAiMins(Math.max(1, Number(e.target.value)))}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs font-semibold outline-none"
                />
                <span className="text-[10px] text-slate-400">Minutes with drawer</span>
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
              <div className="font-semibold text-slate-800">Mathematical Model:</div>
              <div className="font-mono text-[11px] text-navy">Manual = [N × (N-1) / 2] × 12 mins</div>
              <div className="font-mono text-[11px] text-cyan-700">AI Candidate = Suggested Pairs × 3 mins</div>
            </div>
          </div>
        </Card>

        <Card title="Hours Required: Manual vs AI" subtitle="Quantifiable investigator workload comparison">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5dfd0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis unit="h" tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value: any) => [`${Number(value).toLocaleString()} hours`, 'Effort']} />
                <Bar dataKey="hours" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  )
}

export default function Reports() {
  const [sp, setSp] = useSearchParams()
  const kind = sp.get('kind') || 'bureau'
  const period = (sp.get('period') as 'month' | 'quarter') || 'month'
  const region = sp.get('region') || ''
  const bureau = sp.get('bureau') || ''
  const date_from = sp.get('date_from') || ''
  const date_to = sp.get('date_to') || ''

  const setParam = (k: string, v: string) => {
    const n = new URLSearchParams(sp)
    v ? n.set(k, v) : n.delete(k)
    setSp(n, { replace: true })
  }

  const meta = useApi<any>('/meta', false)
  const isRoi = kind === 'roi'

  const apiParams = new URLSearchParams()
  if (region) apiParams.set('region', region)
  if (bureau) apiParams.set('bureau', bureau)
  if (date_from) apiParams.set('date_from', date_from)
  if (date_to) apiParams.set('date_to', date_to)
  if (kind === 'periodic') apiParams.set('period', period)
  const qs = apiParams.toString() ? `?${apiParams.toString()}` : ''

  const { data: rep, error, loading } = useApi<any>(!isRoi ? `/reports/${kind}${qs}` : null)
  const [busy, setBusy] = useState(false)

  async function csv() {
    setBusy(true)
    try {
      const csvParams = new URLSearchParams(apiParams)
      csvParams.set('format', 'csv')
      await download(`/reports/${kind}?${csvParams.toString()}`, `aicte_${kind}_report.csv`)
    } finally {
      setBusy(false)
    }
  }

  const chartRows = rep?.chart?.rows || rep?.rows
  const render = (c: any, v: any) => {
    if (c.key === 'risk_band') return <RiskBadge score={0} band={v} />
    if (c.key === 'risk') return <span className="num font-semibold">{v}</span>
    if (typeof v === 'number') return <span className="num">{v}</span>
    return v
  }

  const hasFilters = Boolean(region || bureau || date_from || date_to)

  return (
    <div className="mx-auto max-w-[1240px] space-y-5">
      <PageHeader eyebrow="Reports" title="Reports and figures"
        subtitle="Pick a report, narrow it by region, Bureau or dates, and download it as a spreadsheet or PDF."
        actions={!isRoi ? <>
          <button onClick={csv} disabled={busy || !rep} className="btn btn-ghost"><FileSpreadsheet size={16} className="text-emerald-600" /> Spreadsheet</button>
          <button onClick={() => rep && exportReportPdf(rep)} disabled={!rep} className="btn btn-primary"><FileDown size={16} /> PDF</button>
        </> : undefined} />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Report">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={kind === k} onClick={() => setParam('kind', k)} className={cx('rounded-full border px-3.5 py-1.5 text-sm font-semibold transition', kind === k ? 'border-navy bg-navy text-white' : 'border-line bg-sheet text-slate-600 hover:border-slate-300 hover:text-slate-900')}>{l}</button>))}
      </div>

      {!isRoi && (
        <Card pad={false}>
          <div className="grid grid-cols-2 gap-3 p-3.5 sm:grid-cols-4 lg:grid-cols-6 items-end">
            <label className="block">
              <span className="eyebrow mb-1 block">Region</span>
              <select
                value={region}
                onChange={(e) => setParam('region', e.target.value)}
                className="field"
              >
                <option value="">All regions</option>
                {(meta.data?.regions || []).map((r: any) => (
                  <option key={r.name} value={r.name}>{r.name}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="eyebrow mb-1 block">Bureau / Cell</span>
              <select
                value={bureau}
                onChange={(e) => setParam('bureau', e.target.value)}
                className="field"
              >
                <option value="">All Bureaus</option>
                {(meta.data?.bureaus || []).map((b: any) => (
                  <option key={b.code} value={b.code}>{b.code} — {b.name}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="eyebrow mb-1 block">Received from</span>
              <input
                type="date"
                value={date_from}
                onChange={(e) => setParam('date_from', e.target.value)}
                className="field"
              />
            </label>

            <label className="block">
              <span className="eyebrow mb-1 block">Received to</span>
              <input
                type="date"
                value={date_to}
                onChange={(e) => setParam('date_to', e.target.value)}
                className="field"
              />
            </label>

            {kind === 'periodic' && (
              <label className="block">
                <span className="eyebrow mb-1 block">Period</span>
                <select
                  value={period}
                  onChange={(e) => setParam('period', e.target.value)}
                  className="field"
                >
                  <option value="month">Monthly</option>
                  <option value="quarter">Quarterly</option>
                </select>
              </label>
            )}

            {hasFilters && (
              <div className="flex items-center pb-0.5">
                <button
                  type="button"
                  onClick={() => {
                    const n = new URLSearchParams()
                    n.set('kind', kind)
                    if (kind === 'periodic') n.set('period', period)
                    setSp(n, { replace: true })
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  <X size={12} /> Clear filters
                </button>
              </div>
            )}
          </div>
        </Card>
      )}

      {isRoi ? (
        <RoiCalculator />
      ) : loading && !rep ? <Loading /> : error && !rep ? <ErrorBox msg={error} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {rep.summary.map((s: any) => (
              <div key={s.label} className="rounded-xl bg-sheet p-4 shadow-sm border border-line">
                <div className="eyebrow">{s.label}</div>
                <div className="font-display num mt-1 text-[1.875rem] font-semibold text-navy">{s.value}</div></div>))}
          </div>


          <Card title={rep.title}
            right={<div className="flex items-center gap-3 text-xs text-slate-400">
              {kind === 'periodic' && (
                <div className="flex rounded-lg bg-slate-100 p-0.5 text-sm">
                  {(['month', 'quarter'] as const).map((p) => <button key={p} onClick={() => setParam('period', p)} className={cx('rounded-md px-2.5 py-1 font-medium capitalize', period === p ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500')}>{p}ly</button>)}
                </div>)}
              {rep.scope} · {rep.generated_at.slice(0, 16).replace('T', ' ')}</div>}>
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={chartRows} margin={{ left: -10, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5dfd0" />
                  <XAxis dataKey={rep.chart.x} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} interval={0} angle={rep.rows.length > 8 ? -25 : 0} textAnchor={rep.rows.length > 8 ? 'end' : 'middle'} height={rep.rows.length > 8 ? 60 : 30} />
                  <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(120,100,50,.07)' }} /><Legend wrapperStyle={{ fontSize: 12 }} />
                  {rep.chart.series.map((s: any, i: number) => (
                    <Bar key={s.key} dataKey={s.key} name={s.label} fill={recolor(s.color)} stackId={rep.chart.stacked ? 'a' : undefined}
                      radius={rep.chart.stacked ? 0 : [4, 4, 0, 0]} />))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card pad={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-400">
                  <tr>{rep.columns.map((c: any) => <th key={c.key} className="whitespace-nowrap px-4 py-2.5 font-medium">{c.label}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {rep.rows.map((r: any, i: number) => (
                    <tr key={i} className="hover:bg-slate-50/70">
                      {rep.columns.map((c: any, j: number) => <td key={c.key} className={cx('px-4 py-2.5', j === 0 ? 'font-medium text-slate-800' : 'text-slate-600')}>{c.key === 'risk_band' ? <RiskBadge score={r.risk} band={r.risk_band} /> : render(c, r[c.key])}</td>)}
                    </tr>))}
                </tbody>
              </table>
            </div>
          </Card>
        </>)}
    </div>
  )
}
