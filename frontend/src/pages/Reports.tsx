import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { FileDown, FileSpreadsheet } from 'lucide-react'
import { download, useApi } from '../api'
import { exportReportPdf } from '../pdf'
import { Card, ErrorBox, Loading, RiskBadge, cx } from '../ui'

const TABS = [
  ['bureau', 'Bureau / Cell-wise'], ['region', 'Region-wise'], ['institution', 'Institution-wise'], ['ageing', 'Pending ageing'],
  ['disposal', 'Disposal rate'], ['overlaps', 'Overlapping cases'], ['periodic', 'Monthly / quarterly'],
]

export default function Reports() {
  const [kind, setKind] = useState('bureau')
  const [period, setPeriod] = useState<'month' | 'quarter'>('month')
  const qs = kind === 'periodic' ? `?period=${period}` : ''
  const { data: rep, error, loading } = useApi<any>(`/reports/${kind}${qs}`)
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
          <p className="text-sm text-slate-500">Bureau-wise, region-wise, institution-wise, ageing, disposal rate, overlaps and periodic performance.</p></div>
        <div className="flex gap-2">
          <button onClick={csv} disabled={busy || !rep} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"><FileSpreadsheet size={16} className="text-emerald-600" /> Export CSV</button>
          <button onClick={() => rep && exportReportPdf(rep)} disabled={!rep} className="flex items-center gap-2 rounded-lg bg-navy px-3.5 py-2 text-sm font-semibold text-white hover:bg-navy-2 disabled:opacity-50"><FileDown size={16} /> Export PDF</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setKind(k)} className={cx('rounded-full px-3.5 py-1.5 text-sm font-medium', kind === k ? 'bg-navy text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50')}>{l}</button>))}
      </div>

      {loading && !rep ? <Loading /> : error && !rep ? <ErrorBox msg={error} /> : (
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
