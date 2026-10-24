import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { FileDown, FileSpreadsheet, Calculator, Clock, Zap, TrendingUp, CheckCircle } from 'lucide-react'
import { download, useApi } from '../api'
import { exportReportPdf } from '../pdf'
import { Card, ErrorBox, Loading, RiskBadge, cx } from '../ui'

const TABS = [
  ['bureau', 'Bureau / Cell-wise'], ['region', 'Region-wise'], ['institution', 'Institution-wise'], ['ageing', 'Pending ageing'],
  ['disposal', 'Disposal rate'], ['overlaps', 'Overlapping cases'], ['periodic', 'Monthly / quarterly'],
  ['roi', 'Effort-saved ROI Model'],
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
    { name: 'Manual Pairwise Review', hours: manualHoursTotal, fill: '#ef4444' },
    { name: 'AI Candidate Review', hours: aiHoursTotal, fill: '#06b6d4' },
  ]

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <Clock size={13} className="text-navy" /> Investigator Hours Saved
          </div>
          <div className="num mt-1 text-2xl font-bold text-emerald-600">
            {hoursSaved.toLocaleString()} hrs
          </div>
          <div className="mt-0.5 text-xs text-slate-500">~{manMonths} officer-months</div>
        </div>

        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <Zap size={13} className="text-amber-500" /> Review Speedup
          </div>
          <div className="num mt-1 text-2xl font-bold text-navy">
            {speedup}x
          </div>
          <div className="mt-0.5 text-xs text-slate-500">Acceleration factor</div>
        </div>

        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Pairwise Combinations</div>
          <div className="num mt-1 text-2xl font-bold text-slate-800">
            {pairwiseTotal.toLocaleString()}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">N × (N-1) / 2 comparisons</div>
        </div>

        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">AI Candidates Evaluated</div>
          <div className="num mt-1 text-2xl font-bold text-cyan-600">
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
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
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
  const [kind, setKind] = useState('bureau')
  const [period, setPeriod] = useState<'month' | 'quarter'>('month')
  const qs = kind === 'periodic' ? `?period=${period}` : ''
  const isRoi = kind === 'roi'
  const { data: rep, error, loading } = useApi<any>(!isRoi ? `/reports/${kind}${qs}` : null)
  const [busy, setBusy] = useState(false)

  async function csv() {
    setBusy(true)
    try { await download(`/reports/${kind}?format=csv${kind === 'periodic' ? `&period=${period}` : ''}`, `aicte_${kind}_report.csv`) } finally { setBusy(false) }
  }

  const chartRows = rep?.chart?.rows || rep?.rows
  const render = (c: any, v: any) => {
    if (c.key === 'risk_band') return <RiskBadge score={0} band={v} />
    if (c.key === 'risk') return <span className="num font-semibold">{v}</span>
    if (typeof v === 'number') return <span className="num">{v}</span>
    return v
  }

  return (
    <div className="mx-auto max-w-[1300px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-xl font-bold tracking-tight">Reports &amp; analytics</h1>
          <p className="text-sm text-slate-500">Bureau-wise, region-wise, institution-wise, ageing, disposal rate, overlaps, periodic and ROI metrics.</p></div>
        {!isRoi && (
          <div className="flex gap-2">
            <button onClick={csv} disabled={busy || !rep} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"><FileSpreadsheet size={16} className="text-emerald-600" /> Export CSV</button>
            <button onClick={() => rep && exportReportPdf(rep)} disabled={!rep} className="flex items-center gap-2 rounded-lg bg-navy px-3.5 py-2 text-sm font-semibold text-white hover:bg-navy-2 disabled:opacity-50"><FileDown size={16} /> Export PDF</button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setKind(k)} className={cx('rounded-full px-3.5 py-1.5 text-sm font-medium', kind === k ? 'bg-navy text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50')}>{l}</button>))}
      </div>

      {isRoi ? (
        <RoiCalculator />
      ) : loading && !rep ? <Loading /> : error && !rep ? <ErrorBox msg={error} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {rep.summary.map((s: any) => (
              <div key={s.label} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{s.label}</div>
                <div className="num mt-1 text-2xl font-bold text-navy">{s.value}</div></div>))}
          </div>


          <Card title={rep.title}
            right={<div className="flex items-center gap-3 text-xs text-slate-400">
              {kind === 'periodic' && (
                <div className="flex rounded-lg bg-slate-100 p-0.5 text-sm">
                  {(['month', 'quarter'] as const).map((p) => <button key={p} onClick={() => setPeriod(p)} className={cx('rounded-md px-2.5 py-1 font-medium capitalize', period === p ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500')}>{p}ly</button>)}
                </div>)}
              {rep.scope} · {rep.generated_at.slice(0, 16).replace('T', ' ')}</div>}>
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={chartRows} margin={{ left: -10, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey={rep.chart.x} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} interval={0} angle={rep.rows.length > 8 ? -25 : 0} textAnchor={rep.rows.length > 8 ? 'end' : 'middle'} height={rep.rows.length > 8 ? 60 : 30} />
                  <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: '#f1f5f9' }} /><Legend wrapperStyle={{ fontSize: 12 }} />
                  {rep.chart.series.map((s: any, i: number) => (
                    <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} stackId={rep.chart.stacked ? 'a' : undefined}
                      radius={rep.chart.stacked ? 0 : [4, 4, 0, 0]} />))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card pad={false}>
<div
  className="overflow-x-auto"
  tabIndex={0}
  role="region"
  aria-label="Scrollable reports table"
>              <table className="w-full text-sm">
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
