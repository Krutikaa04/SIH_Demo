import { Link, useNavigate } from 'react-router-dom'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertOctagon, CheckCircle2, Clock, FolderOpen, GitMerge, Hourglass, Inbox, PiggyBank, Repeat2, TrendingUp, Workflow } from 'lucide-react'
import IndiaMap from './IndiaMap'
import { BureauBadge, Card, RiskBadge, STATUS_COLORS, Stat, ago, cx } from '../ui'

const tip = {
  contentStyle: { background: 'rgb(8 13 34 / .94)', border: '1px solid rgb(255 255 255 / .12)', borderRadius: 12, fontSize: 12, color: '#eaeeff', boxShadow: '0 16px 40px -12px rgb(0 0 0 / .6)', backdropFilter: 'blur(8px)' },
  itemStyle: { color: '#eaeeff' }, labelStyle: { color: '#9aa7d0', fontWeight: 600 }, cursor: { fill: 'rgb(59 94 250 / .08)' },
}
const axis = { tick: { fontSize: 12, fill: 'var(--color-slate-500)' }, axisLine: false as const, tickLine: false as const }
const grid = { strokeDasharray: '3 5', vertical: false, stroke: 'var(--color-line)' }

/** Every organisation-wide number and chart. */
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
  const trend = (d.trend || []).map((m: any) => m)

  const counts: [string, number, string, any, any, string?][] = [
    ['Total received', t.received, '/cases', 'ink', Inbox],
    ['Pending', t.pending, '/cases?status=Pending', 'blue', Hourglass, 'not yet disposed'],
    ['Under process', t.under_process, '/cases?status=Under Process', 'ink', Workflow],
    ['Disposed', t.disposed, '/cases?status=Disposed', 'green', CheckCircle2, `${rate}% of all`],
    ['Transferred', t.transferred, '/cases?status=Transferred', 'ink', Repeat2],
    ['Escalated', t.escalated, '/cases?status=Escalated', 'amber', TrendingUp],
    ['Past due date', t.beyond_sla, '/cases?overdue=1', 'red', AlertOctagon, 'beyond the prescribed timeline'],
    ['Nearly due', t.nearing_sla, '/cases?status=Pending', 'amber', Clock, '75% or more of the time used'],
  ]

  return (
    <div className="space-y-6">
      <Card title="All case counts" subtitle="Across every Bureau and Cell. Select a number to see those cases.">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {counts.map(([l, v, to, tone, icon, hint]) => <Stat key={l} small label={l} value={v} to={to} tone={tone} icon={icon} hint={hint} />)}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-12">
        <Card title="Where cases stand" className="lg:col-span-4">
          <div className="flex items-center gap-2">
            <div className="relative h-52 w-1/2">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={statusData} dataKey="value" innerRadius={54} outerRadius={80} paddingAngle={3} cornerRadius={6} stroke="none">
                    {statusData.map((s) => <Cell key={s.name} fill={STATUS_COLORS[s.name] || '#8792b8'} />)}
                  </Pie>
                  <Tooltip {...tip} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><div className="font-display num text-[1.6rem] font-bold leading-none">{t.received}</div><div className="eyebrow mt-1 !text-[9.5px]">cases</div></div></div>
            </div>
            <ul className="w-1/2 space-y-2.5 text-[13px]">
              {statusData.map((s) => (
                <li key={s.name} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLORS[s.name] || '#8792b8', boxShadow: `0 0 8px ${STATUS_COLORS[s.name] || '#8792b8'}` }} />
                  <span className="flex-1 text-slate-600">{s.name}</span>
                  <span className="num font-bold">{s.value}</span>
                </li>))}
            </ul>
          </div>
        </Card>

        <Card title="Open cases by Bureau" subtitle="Within the time allowed, or past it" className="lg:col-span-5">
          <div className="h-52">
            <ResponsiveContainer>
              <BarChart data={d.workload.map((w: any) => ({ ...w, ontime: w.pending - w.overdue }))} margin={{ left: -18, top: 8 }} barCategoryGap="28%">
                <defs>
                  <linearGradient id="gOn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5f82ff" /><stop offset="1" stopColor="#2646e6" /></linearGradient>
                  <linearGradient id="gLate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff7a85" /><stop offset="1" stopColor="#d92d43" /></linearGradient>
                </defs>
                <CartesianGrid {...grid} />
                <XAxis dataKey="bureau" {...axis} /><YAxis {...axis} />
                <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                <Bar dataKey="ontime" name="Within time" stackId="a" fill="url(#gOn)" />
                <Bar dataKey="overdue" name="Past due date" stackId="a" fill="url(#gLate)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Coordination at a glance" className="lg:col-span-3">
          <div className="space-y-3">
            <Link to="/overlaps" className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-red-200 bg-red-50 p-3.5 transition hover:-translate-y-0.5 hover:shadow-md">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-red-100 text-red-600"><GitMerge size={20} /></span>
              <div><div className="font-display num text-[1.75rem] font-bold leading-none text-red-700">{d.overlap.open_clusters}</div><div className="mt-1 text-xs text-red-700/80">institutions with overlapping cases</div></div>
            </Link>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl bg-slate-100 p-3"><div className="font-display num text-xl font-bold">{d.overlap.rooms_active}</div><div className="text-[11px] text-slate-500">rooms in use</div></div>
              <div className="rounded-xl bg-slate-100 p-3"><div className="font-display num text-xl font-bold">{d.overlap.resolved_clusters}</div><div className="text-[11px] text-slate-500">settled</div></div>
            </div>
            <div title={d.effort_saved.assumptions} className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-emerald-100 text-emerald-600"><PiggyBank size={20} /></span>
              <div>
                <div className="font-display num text-lg font-bold leading-none text-emerald-700">{d.effort_saved.officer_hours}h · {d.effort_saved.days}d</div>
                <div className="mt-1 text-xs text-emerald-700/80">duplicate effort saved (estimate)</div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
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
                    <td className="px-5 text-right">{i.overlap && <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-px text-[10px] font-bold uppercase tracking-wider text-indigo-700">Overlap</span>}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="How long cases have waited" subtitle="Open cases by age">
          <div className="h-52">
            <ResponsiveContainer>
              <BarChart data={Object.entries(d.ageing).map(([k, v]) => ({ bucket: k + ' days', count: v }))} margin={{ left: -20, top: 6 }}>
                <CartesianGrid {...grid} />
                <XAxis dataKey="bucket" {...axis} /><YAxis {...axis} />
                <Tooltip {...tip} />
                <Bar dataKey="count" name="Open cases" radius={[8, 8, 0, 0]}>
                  {['#10b981', '#fbbf24', '#ff8a1f', '#ec4658'].map((c, i) => <Cell key={i} fill={c} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Coming in, going out" subtitle="Last six months">
          <div className="h-52">
            <ResponsiveContainer>
              <AreaChart data={trend} margin={{ left: -20, top: 6 }}>
                <defs>
                  <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3b5efa" stopOpacity=".45" /><stop offset="1" stopColor="#3b5efa" stopOpacity="0" /></linearGradient>
                  <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#10b981" stopOpacity=".4" /><stop offset="1" stopColor="#10b981" stopOpacity="0" /></linearGradient>
                </defs>
                <CartesianGrid {...grid} />
                <XAxis dataKey="month" {...axis} /><YAxis {...axis} />
                <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                <Area type="monotone" dataKey="received" name="Received" stroke="#3b5efa" strokeWidth={2.5} fill="url(#gIn)" dot={{ r: 3, strokeWidth: 0, fill: '#3b5efa' }} />
                <Area type="monotone" dataKey="disposed" name="Disposed" stroke="#10b981" strokeWidth={2.5} fill="url(#gOut)" dot={{ r: 3, strokeWidth: 0, fill: '#10b981' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Latest activity" subtitle="Updates as it happens">
          <ul className="space-y-3.5">
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
