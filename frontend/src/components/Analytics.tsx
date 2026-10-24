import { Link, useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { GitMerge, PiggyBank } from 'lucide-react'
import IndiaMap from './IndiaMap'
import { BureauBadge, Card, RiskBadge, STATUS_COLORS, Stat, ago, cx } from '../ui'

const tip = { contentStyle: { background: '#fdfbf6', border: '1px solid #e3dccb', borderRadius: 8, fontSize: 12, boxShadow: '0 8px 24px -8px rgba(60,45,10,.25)' }, cursor: { fill: 'rgba(120,100,50,.07)' } }
const axis = { tick: { fontSize: 12, fill: '#77736a' }, axisLine: false as const, tickLine: false as const }
const grid = { strokeDasharray: '2 4', vertical: false, stroke: '#e5dfd0' }

/** Every organisation-wide number and chart. Same content as before, in the new language. */
export default function Analytics({ d }: { d: any }) {
  const nav = useNavigate()
  const t = d.totals
  const statusData = [
    { name: 'Received / Pending Info', value: t.received - t.disposed - t.under_process - t.transferred - t.escalated },
    { name: 'Under Process', value: t.under_process },
    { name: 'Transferred', value: t.transferred },
    { name: 'Escalated', value: t.escalated },
    { name: 'Disposed', value: t.disposed },
  ].filter((x) => x.value > 0)
  const rate = t.received ? Math.round((t.disposed / t.received) * 100) : 0

  const counts: [string, number, string, any, string?][] = [
    ['Total received', t.received, '/cases', 'ink'],
    ['Pending', t.pending, '/cases?status=Pending', 'blue', 'not yet disposed'],
    ['Under process', t.under_process, '/cases?status=Under Process', 'ink'],
    ['Disposed', t.disposed, '/cases?status=Disposed', 'green', `${rate}% of all`],
    ['Transferred', t.transferred, '/cases?status=Transferred', 'ink'],
    ['Escalated', t.escalated, '/cases?status=Escalated', 'amber'],
    ['Past due date', t.beyond_sla, '/cases?overdue=1', 'red', 'beyond the prescribed timeline'],
    ['Nearly due', t.nearing_sla, '/cases?status=Pending', 'amber', '75% or more of the time used'],
  ]

  return (
    <div className="space-y-5">
      <Card title="All case counts" subtitle="Across every Bureau and Cell. Select a number to see those cases.">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {counts.map(([l, v, to, tone, hint]) => <Stat key={l} small label={l} value={v} to={to} tone={tone} hint={hint} />)}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-12">
        <Card title="Where cases stand" className="lg:col-span-4">
          <div className="flex items-center gap-2">
            <div className="h-48 w-1/2">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={statusData} dataKey="value" innerRadius={46} outerRadius={76} paddingAngle={2} stroke="#fdfbf6" strokeWidth={2}>
                    {statusData.map((s) => <Cell key={s.name} fill={STATUS_COLORS[s.name] || '#8a8575'} />)}
                  </Pie>
                  <Tooltip {...tip} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="w-1/2 space-y-2 text-[13px]">
              {statusData.map((s) => (
                <li key={s.name} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: STATUS_COLORS[s.name] || '#8a8575' }} />
                  <span className="flex-1 text-slate-600">{s.name}</span>
                  <span className="num font-semibold">{s.value}</span>
                </li>))}
            </ul>
          </div>
        </Card>

        <Card title="Open cases by Bureau" subtitle="Within the time allowed, or past it" className="lg:col-span-5">
          <div className="h-48">
            <ResponsiveContainer>
              <BarChart data={d.workload.map((w: any) => ({ ...w, ontime: w.pending - w.overdue }))} margin={{ left: -18, top: 8 }}>
                <CartesianGrid {...grid} />
                <XAxis dataKey="bureau" {...axis} /><YAxis {...axis} />
                <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="ontime" name="Within time" stackId="a" fill="#364f8f" />
                <Bar dataKey="overdue" name="Past due date" stackId="a" fill="#b93b1f" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Coordination at a glance" className="lg:col-span-3">
          <div className="space-y-3">
            <Link to="/overlaps" className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3 transition hover:bg-red-100/70">
              <GitMerge className="text-red-600" size={20} />
              <div><div className="font-display num text-2xl font-semibold leading-none text-red-700">{d.overlap.open_clusters}</div><div className="mt-1 text-xs text-red-700/80">institutions with overlapping cases</div></div>
            </Link>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg bg-slate-100 p-2.5"><div className="font-display num text-xl font-semibold">{d.overlap.rooms_active}</div><div className="text-[11px] text-slate-500">rooms in use</div></div>
              <div className="rounded-lg bg-slate-100 p-2.5"><div className="font-display num text-xl font-semibold">{d.overlap.resolved_clusters}</div><div className="text-[11px] text-slate-500">settled</div></div>
            </div>
            <div title={d.effort_saved.assumptions} className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <PiggyBank className="text-emerald-600" size={20} />
              <div>
                <div className="font-display num text-lg font-semibold leading-none text-emerald-700">{d.effort_saved.officer_hours}h · {d.effort_saved.days}d</div>
                <div className="mt-1 text-xs text-emerald-700/80">duplicate effort saved (estimate)</div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        <Card title="Regions" subtitle="Select a region to open its pending cases" className="lg:col-span-5">
          <IndiaMap regions={d.regions} onSelect={(r) => nav(`/cases?region=${r}&status=Pending`)} />
        </Card>
        <Card title="Institutions to watch" subtitle="Highest risk first" className="lg:col-span-7"
          right={<Link to="/institutions" className="text-[13px] font-semibold text-navy-2 hover:underline">All institutions</Link>} pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th className="eyebrow px-5 py-2">Institution</th><th className="eyebrow px-2 py-2">Risk</th><th className="eyebrow px-2 py-2 text-right">Open</th><th className="eyebrow px-2 py-2 text-right">Past due</th><th className="px-5 py-2" /></tr></thead>
              <tbody className="divide-y divide-line">
                {d.top_institutions.map((i: any) => (
                  <tr key={i.aicte_id} className="cursor-pointer transition hover:bg-slate-50" onClick={() => nav(`/institutions/${i.aicte_id}`)}>
                    <td className="px-5 py-2.5"><div className="font-medium text-slate-900">{i.name}</div><div className="text-xs text-slate-400">{i.region}</div></td>
                    <td className="px-2"><RiskBadge score={i.risk} band={i.risk_band} /></td>
                    <td className="num px-2 text-right font-semibold">{i.open}</td>
                    <td className={cx('num px-2 text-right font-semibold', i.overdue ? 'text-red-600' : 'text-slate-300')}>{i.overdue}</td>
                    <td className="px-5 text-right">{i.overlap && <span className="rounded-[4px] border border-red-200 bg-red-50 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-red-700">Overlap</span>}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="How long cases have waited" subtitle="Open cases by age">
          <div className="h-48">
            <ResponsiveContainer>
              <BarChart data={Object.entries(d.ageing).map(([k, v]) => ({ bucket: k + ' days', count: v }))} margin={{ left: -20, top: 6 }}>
                <CartesianGrid {...grid} />
                <XAxis dataKey="bucket" {...axis} /><YAxis {...axis} />
                <Tooltip {...tip} />
                <Bar dataKey="count" name="Open cases" radius={[4, 4, 0, 0]}>
                  {['#2c7f59', '#d9ad1c', '#d67a17', '#b93b1f'].map((c, i) => <Cell key={i} fill={c} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Coming in, going out" subtitle="Last six months">
          <div className="h-48">
            <ResponsiveContainer>
              <LineChart data={d.trend} margin={{ left: -20, top: 6 }}>
                <CartesianGrid {...grid} />
                <XAxis dataKey="month" {...axis} /><YAxis {...axis} />
                <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="received" name="Received" stroke="#364f8f" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="disposed" name="Disposed" stroke="#2c7f59" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Latest activity" subtitle="Updates as it happens">
          <ul className="space-y-3">
            {d.activity.map((a: any, i: number) => (
              <li key={i} className="flex gap-3 text-sm">
                <BureauBadge code={a.bureau} className="mt-0.5 h-fit" />
                <div className="min-w-0 flex-1">
                  <Link to={`/cases/${a.case_id}`} className="case-id text-slate-900 hover:underline">{a.case_id}</Link>
                  <span className="ml-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">{a.action_type.replace('_', ' ')}</span>
                  <div className="truncate text-[13px] text-slate-600">{a.remarks}</div>
                  <div className="truncate text-[11.5px] text-slate-400">{a.institution} · {ago(a.ts)}</div>
                </div>
              </li>))}
          </ul>
        </Card>
      </div>
    </div>
  )
}
