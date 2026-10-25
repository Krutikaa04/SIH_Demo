import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { FileDown, FileSpreadsheet, Calculator, Clock, Zap, TrendingUp, CheckCircle, X } from 'lucide-react'
import { download, useApi, useRole } from '../api'
import { exportReportPdf } from '../pdf'
import { Card, ErrorBox, Loading, PageHeader, RiskBadge, cx } from '../ui'

const PALETTE: Record<string, string> = {
  '#3b82f6': '#3b5efa', '#dc2626': '#ec4658', '#16a34a': '#10b981', '#1d4ed8': '#3b5efa', '#7c3aed': '#a855f7', '#0d9488': '#10a59b',
  '#b45309': '#f59e0b', '#be123c': '#e5484d', '#22c55e': '#10b981', '#eab308': '#fbbf24', '#f97316': '#ff8a1f', '#2563eb': '#3b5efa',
}
const recolor = (c: string) => PALETTE[c] || c

const TABS = [
  ['bureau', 'Bureau / Cell-wise'], ['region', 'Region-wise'], ['institution', 'Institution-wise'],
  ['status', 'Status-wise'], ['ageing', 'Pending ageing'],
  ['disposal', 'Disposal rate'], ['overlaps', 'Overlapping cases'], ['periodic', 'Monthly / quarterly'],
  ['coordination', 'Coordination outcomes'], ['roi', 'Workload scenario'],
]

function RoiCalculator() {
  const [complaintCount, setComplaintCount] = useState(300)
  const [candidateShare, setCandidateShare] = useState(5)
  const [manualMins, setManualMins] = useState(12)
  const [assistedMins, setAssistedMins] = useState(3)
  const pairs = complaintCount * (complaintCount - 1) / 2
  const candidates = Math.ceil(pairs * candidateShare / 100)
  const manualHours = pairs * manualMins / 60
  const assistedHours = candidates * assistedMins / 60
  const difference = manualHours - assistedHours
  const fields = [
    { label: 'Complaints in this scenario', value: complaintCount, set: setComplaintCount, min: 50, max: 1500, step: 25 },
    { label: 'Assumed candidate pairs (% of all pairs)', value: candidateShare, set: setCandidateShare, min: 0.1, max: 100, step: 0.1 },
    { label: 'Manual minutes per pair', value: manualMins, set: setManualMins, min: 1, max: 60, step: 1 },
    { label: 'Assisted review minutes per candidate', value: assistedMins, set: setAssistedMins, min: 1, max: 60, step: 1 },
  ]
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">
        <strong>Hypothetical workload scenario.</strong> These figures come from your assumptions, not observed officer time.
        The baseline assumes every possible pair is reviewed manually. Actual teams may review far fewer pairs.
        <Link className="ml-1 font-semibold underline" to="/reports?kind=coordination">See recorded coordination outcomes.</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Assumed manual workload', `${manualHours.toFixed(1)} h`],
          ['Assumed assisted workload', `${assistedHours.toFixed(1)} h`],
          ['Scenario difference', `${difference.toFixed(1)} h`],
          ['Assumed candidate pairs', candidates.toLocaleString()],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-line bg-sheet p-4">
          <div className="eyebrow">{label}</div><div className="mt-2 break-words font-display text-2xl font-semibold num">{value}</div>
        </div>)}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Choose the assumptions" subtitle="Adjust each value to test a different workload">
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((f) => <label key={f.label} className="text-sm text-slate-600">
              <span className="mb-1.5 block">{f.label}</span>
              <input className="field" type="number" value={f.value} min={f.min} max={f.max} step={f.step}
                onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) f.set(Math.min(f.max, Math.max(f.min, n))) }} />
            </label>)}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            All possible pairs = N × (N − 1) ÷ 2 ({pairs.toLocaleString()}). Candidate pairs = all pairs × the assumed percentage, rounded up.
            Workload = pair count × minutes ÷ 60. A negative difference means more work under the selected assisted-review assumptions.
          </p>
        </Card>
        <Card title="Scenario comparison" subtitle="Calculated hours under the selected assumptions">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[{ name: 'Manual scenario', hours: manualHours }, { name: 'Assisted scenario', hours: assistedHours }]}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-line)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis unit="h" tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value: any) => [`${Number(value).toFixed(1)} hours`, 'Scenario workload']} />
                <Bar dataKey="hours" fill="#364f8f" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  )
}

function CoordinationEvidence({ report }: { report: any }) {
  return (
    <div className="space-y-5">
    {report.reviews.length > 0 && <Card title="Officer review records" subtitle="Latest explicit review per pair; each case contains the audit entry">
      <div className="grid gap-3 md:grid-cols-2">{report.reviews.map((review: any) => <div key={review.pair_id} className="min-w-0 rounded-lg border border-line p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm"><b>{review.pair_id}</b><span>{review.decision}</span></div>
        <p className="mt-1 text-xs text-slate-500">{review.reviewed_by} · {review.reviewed_at.slice(0, 16).replace('T', ' ')}</p>
        <div className="mt-2 flex flex-wrap gap-2">{review.cases.map((c: any) => <Link key={c.label} to={c.href} className="break-all font-mono text-xs text-navy-2 underline">{c.label}</Link>)}</div>
      </div>)}</div>
    </Card>}
    <Card title="Check the room records" subtitle="Open a room or case to inspect the source of these outcomes">
      {report.evidence.length === 0 ? <p className="text-sm text-slate-500">No coordination rooms in this case cohort yet. Open an overlap and create a room to start recording outcomes.</p> :
        <div className="grid gap-3 md:grid-cols-2">
          {report.evidence.map((room: any) => <div key={room.room_id} className="min-w-0 rounded-lg border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link to={room.href} className="font-semibold text-navy-2 underline">{room.room_id}</Link>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{room.outcome || room.status}</span>
            </div>
            <p className="mt-2 break-words text-sm font-semibold">{room.institution}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">Lead: {room.lead_bureau} · {room.selected_cases} selected cases · {room.pending_followers} pending followers ({room.overdue_followers} past due)</p>
            <div className="mt-3 flex flex-wrap gap-2">{room.cases.map((c: any) => <Link key={c.label} to={c.href} className="break-all rounded bg-slate-50 px-2 py-1 font-mono text-xs text-navy-2 underline">{c.label}</Link>)}</div>
          </div>)}
        </div>}
    </Card>
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

  const me = useRole()
  const meta = useApi<any>('/meta', false)
  const isRoi = kind === 'roi'

  const apiParams = new URLSearchParams()
  if (region) apiParams.set('region', region)
  if (bureau) apiParams.set('bureau', bureau)
  if (date_from) apiParams.set('date_from', date_from)
  if (date_to) apiParams.set('date_to', date_to)
  if (kind === 'periodic') apiParams.set('period', period)
  const qs = apiParams.toString() ? `?${apiParams.toString()}` : ''

  const { data: loadedReport, error, loading } = useApi<any>(!isRoi ? `/reports/${kind}${qs}` : null)
  const expectedRegion = me.role === 'REGIONAL' ? me.region : region
  const rep = (me.role !== 'REGIONAL' || Boolean(me.region)) && loadedReport?.kind === kind && loadedReport.filters?.region === expectedRegion
    && loadedReport.filters?.bureau === bureau && loadedReport.filters?.date_from === date_from
    && loadedReport.filters?.date_to === date_to && loadedReport.filters?.period === (kind === 'periodic' ? period : '')
    ? loadedReport : null
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
    return v ?? '—'
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
      ) : !rep && (loading || !error) ? <Loading /> : error && !rep ? <ErrorBox msg={error} /> : (
        <>
          {kind === 'coordination' && <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed text-slate-700">{rep.methodology}</div>}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {rep.summary.map((s: any) => (
              <div key={s.label} className="rounded-xl bg-sheet p-4 shadow-sm border border-line">
                <div className="eyebrow">{s.label}</div>
                <div className="font-display num mt-1 text-[1.875rem] font-semibold text-navy">{s.value}</div></div>))}
          </div>


          {kind === 'coordination' && <CoordinationEvidence report={rep} />}
          <Card title={rep.title}
            right={<div className="flex items-center gap-3 text-xs text-slate-400">
              {kind === 'periodic' && (
                <div className="flex rounded-lg bg-slate-100 p-0.5 text-sm">
                  {(['month', 'quarter'] as const).map((p) => <button key={p} onClick={() => setParam('period', p)} className={cx('rounded-md px-2.5 py-1 font-medium capitalize', period === p ? 'bg-sheet shadow-sm text-slate-900' : 'text-slate-500')}>{p}ly</button>)}
                </div>)}
              {rep.scope} · {rep.generated_at.slice(0, 16).replace('T', ' ')}</div>}>
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={chartRows} margin={{ left: -10, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-line)" />
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
