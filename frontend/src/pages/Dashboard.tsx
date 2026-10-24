import { Link, useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertOctagon, ArrowRight, Building2, Crown, Sparkles, CheckCircle2, Clock, FolderInput, GitMerge, Hourglass, Inbox, PiggyBank, Repeat2, Siren, Workflow } from 'lucide-react'
import { useApi } from '../api'
import IndiaMap from '../components/IndiaMap'
import { BUREAU_COLORS, BureauBadge, Card, ErrorBox, Loading, RiskBadge, SlaChip, StatusChip, STATUS_COLORS, ago, cx } from '../ui'

function Kpi({ label, value, icon: Icon, tone, to, sub }: any) {
  const nav = useNavigate()
  const tones: any = {
    slate: ['#475569', '#f1f5f9'], blue: ['#2563eb', '#eff6ff'], green: ['#16a34a', '#f0fdf4'],
    red: ['#dc2626', '#fef2f2'], amber: ['#d97706', '#fffbeb'], sky: ['#0284c7', '#f0f9ff'], orange: ['#ea580c', '#fff7ed'],
    navy: ['#0b2a4a', '#eef2f7'],
  }
  const [fg, bg] = tones[tone]
  return (
    <button onClick={() => to && nav(to)} className="group relative overflow-hidden rounded-xl bg-white p-2 sm:p-4 text-left shadow-sm ring-1 ring-slate-200/70 transition hover:shadow-md">
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: fg }} />
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
          <div className="num mt-1.5 text-2xl sm:text-3xl font-bold tracking-tight" style={{ color: fg }}>{value}</div>
          {sub && <div className="mt-0.5 text-[11px] text-slate-600">{sub}</div>}
        </div>
        <div className="shrink-0 rounded-lg p-1.5 sm:p-2" style={{ background: bg, color: fg }}><Icon size={18} /></div>
      </div>
    </button>
  )
}

export default function Dashboard() {
  const { data: d, error, loading } = useApi<any>('/dashboard/summary')
  const nav = useNavigate()
  if (loading && !d) return <Loading />
  if (error && !d) return <ErrorBox msg={error} />
  const t = d.totals
  const statusData = [
    { name: 'Received', value: d.totals.received - d.totals.disposed - d.totals.under_process - d.totals.transferred - d.totals.escalated },
    { name: 'Under Process', value: d.totals.under_process },
    { name: 'Transferred', value: d.totals.transferred },
    { name: 'Escalated', value: d.totals.escalated },
    { name: 'Disposed', value: d.totals.disposed },
  ].filter((x) => x.value > 0)
  const rcv = statusData.find((x: any) => x.name === 'Received'); if (rcv) rcv.name = 'Received / Pending Info'
  const disposalRate = Math.round((t.disposed / t.received) * 100)

  return (
<div className="mx-auto min-w-0 w-full max-w-[1500px] space-y-5">      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Single-Window Complaint Overview</h1>
          <p className="text-sm text-slate-600">All Bureaus and Cells in one place Â· as of {new Date(d.as_of).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Live
        </span>
      </div>

      {d.role === 'REGIONAL' && (
        <div className="flex items-center gap-3 rounded-xl bg-indigo-50 p-3.5 text-sm text-indigo-900 ring-1 ring-indigo-200">
          <Building2 size={18} /> <span><b>Regional Office view â€” {d.region} region.</b> You see only complaints about institutions in your region and can add remarks; Bureau actions stay with the Bureaus.</span>
        </div>)}
      {d.role === 'SENIOR' && (
        <div className="flex items-center gap-3 rounded-xl bg-slate-100 p-3.5 text-sm text-slate-700 ring-1 ring-slate-200">
          <Crown size={18} className="text-amber-600" /> <span><b>Senior Management view.</b> Cross-Bureau overview with authority to decide in Coordination Rooms and escalate cases. Case actions by Bureaus are read-only here.</span>
        </div>)}

      {(d.role === 'SENIOR' || d.role === 'REGIONAL') && d.briefing?.length > 0 && (
        <Card title={<span className="flex items-center gap-2"><Sparkles size={16} className="text-amber-500" /> Daily briefing{d.role === 'REGIONAL' ? ` â€” ${d.region}` : ''}</span>}
          right={<span className="text-[11px] text-slate-600">auto-generated from live data Â· rule-based</span>}>
          <ul className="grid gap-x-8 gap-y-2.5 md:grid-cols-2">
            {d.briefing.map((b: any, i: number) => (
              <li key={i}><Link to={b.link} className="group flex gap-2.5 text-sm text-slate-700 hover:text-slate-900">
                <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', { red: 'bg-red-500', amber: 'bg-amber-500', blue: 'bg-blue-500', green: 'bg-emerald-500' }[b.tone as string] || 'bg-slate-400')} />
                <span className="group-hover:underline">{b.text}</span></Link></li>))}
          </ul>
        </Card>)}

      {d.desk && (
        <Card title={<span className="flex items-center gap-2"><BureauBadge code={d.desk.bureau} /> My desk â€” {d.desk.name}</span>}
          right={<Link to={`/cases?bureau=${d.desk.bureau}&status=Pending`} className="text-xs font-medium text-navy-2 hover:underline">All my open cases</Link>}>
<div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-12">
  <div className="grid min-w-0 grid-cols-2 gap-3 max-[480px]:gap-2 lg:col-span-5">
                {[['Open', d.desk.open, 'text-blue-700'], ['Overdue', d.desk.overdue, 'text-red-600'], ['Nearing', d.desk.nearing, 'text-amber-600'],
                ['Escalated', d.desk.escalated, 'text-orange-600'], ['In overlap', d.desk.in_overlap, 'text-red-700']].map(([l, v, c]: any) => (
             <div key={l} className="min-w-0 rounded-lg bg-slate-50 p-3 text-center"><div className={cx('num text-2xl font-bold', c)}>{v}</div><div className="text-[10.5px] uppercase tracking-wider text-slate-400">{l}</div></div>))}
            </div>
            <div className="lg:col-span-7">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Needs your attention first</div>
              <ul className="divide-y divide-slate-100">
                {d.desk.urgent.map((u: any) => (
<li key={u.case_id} className="flex min-w-0 flex-wrap items-center gap-3 py-2 text-sm lg:flex-nowrap">
<Link to={`/cases/${u.case_id}`} className="min-w-0 font-semibold text-navy-2 hover:underline lg:w-36 lg:shrink-0">{u.case_id}</Link>
                    <span className="min-w-0 flex-1 truncate text-slate-600">{u.institution}</span>
                    <StatusChip status={u.status} /><SlaChip sla={u.sla} />
                  </li>))}
              </ul>
            </div>
          </div>
        </Card>)}

      {d.overlap.open_clusters > 0 && (
<Link to="/overlaps" className="group flex flex-col items-start gap-4 rounded-xl bg-gradient-to-r from-red-700 to-red-600 p-4 text-white shadow-md transition hover:shadow-lg sm:flex-row sm:items-center">          <div className="rounded-full bg-white/15 p-2.5"><Siren size={22} /></div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold">Potential Overlapping Cases â€” Coordination Required</div>
            <div className="text-sm text-red-100">{d.overlap.open_clusters} institutions have complaints being handled by multiple Bureaus in parallel ({d.overlap.cases_involved} cases involved).</div>
          </div>
<span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold transition group-hover:bg-white/25">
  Review overlaps <ArrowRight size={15} />
</span>        </Link>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Total received" value={t.received} icon={Inbox} tone="navy" to="/cases" />
        <Kpi label="Pending" value={t.pending} icon={Hourglass} tone="blue" to="/cases?status=Pending" sub="not yet disposed" />
        <Kpi label="Under process" value={t.under_process} icon={Workflow} tone="slate" to="/cases?status=Under Process" />
        <Kpi label="Disposed" value={t.disposed} icon={CheckCircle2} tone="green" to="/cases?status=Disposed" sub={`${disposalRate}% disposal rate`} />
        <Kpi label="Transferred" value={t.transferred} icon={Repeat2} tone="sky" to="/cases?status=Transferred" />
        <Kpi label="Escalated" value={t.escalated} icon={FolderInput} tone="orange" to="/cases?status=Escalated" />
        <Kpi label="Beyond timeline" value={t.beyond_sla} icon={AlertOctagon} tone="red" to="/cases?overdue=1" sub="past prescribed SLA" />
        <Kpi label="Nearing timeline" value={t.nearing_sla} icon={Clock} tone="amber" to="/cases?status=Pending" sub="â‰¥ 75% of SLA used" />
      </div>

<div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12">        <Card title="Case status mix" className="lg:col-span-4">
          <div className="flex flex-col items-center sm:flex-row">
            <div className="h-52 w-full sm:w-1/2">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={statusData} dataKey="value" innerRadius={48} outerRadius={78} paddingAngle={2} stroke="none">
                    {statusData.map((s: any) => <Cell key={s.name} fill={STATUS_COLORS[s.name] || STATUS_COLORS.Received} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="w-full space-y-2 text-sm sm:w-1/2">
              {statusData.map((s: any) => (
                <li key={s.name} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_COLORS[s.name] || STATUS_COLORS.Received }} />
                  <span className="flex-1 text-slate-600">{s.name}</span>
                  <span className="num font-semibold">{s.value}</span>
                </li>))}
            </ul>
          </div>
        </Card>

        <Card title="Bureau / Cell workload (open cases)" className="lg:col-span-5">
          <div className="h-52 min-w-0">
            <ResponsiveContainer>
              <BarChart data={d.workload.map((w: any) => ({ ...w, ontime: w.pending - w.overdue }))} margin={{ left: -18, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="bureau" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: '#f1f5f9' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="ontime" name="Within timeline" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                <Bar dataKey="overdue" name="Beyond timeline" stackId="a" fill="#dc2626" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Coordination impact" className="lg:col-span-3">
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-lg bg-red-50 p-3">
              <GitMerge className="text-red-600" size={20} />
              <div><div className="num text-xl font-bold text-red-700">{d.overlap.open_clusters}</div><div className="text-xs text-red-700/80">open overlap clusters</div></div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg bg-slate-50 p-2.5"><div className="num text-lg font-bold">{d.overlap.rooms_active}</div><div className="text-[11px] text-slate-500">rooms active</div></div>
              <div className="rounded-lg bg-slate-50 p-2.5"><div className="num text-lg font-bold">{d.overlap.resolved_clusters}</div><div className="text-[11px] text-slate-500">resolved</div></div>
            </div>
            <div title={d.effort_saved.assumptions} className="flex items-center gap-3 rounded-lg bg-emerald-50 p-3">
              <PiggyBank className="text-emerald-600" size={20} />
              <div>
                <div className="num text-base font-bold text-emerald-700">{d.effort_saved.officer_hours}h Â· {d.effort_saved.days}d</div>
                <div className="text-xs text-emerald-700/80">duplicate effort saved (est.)</div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12">
<Card title="Region heatmap" className="min-w-0 overflow-hidden lg:col-span-5"
          right={<span className="text-[11px] text-slate-400">click a region to open its cases</span>}>
          <IndiaMap regions={d.regions} onSelect={(r) => nav(`/cases?region=${r}&status=Pending`)} />
        </Card>
        <Card title="Highest-risk institutions" className="min-w-0 lg:col-span-7"
          right={<Link to="/institutions" className="text-xs font-medium text-navy-2 hover:underline">All institutions</Link>} pad={false}>
          <div className="min-w-0 max-w-full overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-400">
              <th className="px-4 py-2 font-medium">Institution</th><th className="px-2 py-2 font-medium">Risk</th><th className="px-2 py-2 text-right font-medium">Open</th><th className="px-2 py-2 text-right font-medium">Overdue</th><th className="px-4 py-2" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {d.top_institutions.map((i: any) => (
                <tr key={i.aicte_id} className="cursor-pointer hover:bg-slate-50" onClick={() => nav(`/institutions/${i.aicte_id}`)}>
                  <td className="px-4 py-2.5"><div className="font-medium text-slate-800">{i.name}</div><div className="text-xs text-slate-400">{i.region}</div></td>
                  <td className="px-2"><RiskBadge score={i.risk} band={i.risk_band} /></td>
                  <td className="num px-2 text-right font-semibold">{i.open}</td>
                  <td className={cx('num px-2 text-right font-semibold', i.overdue ? 'text-red-600' : 'text-slate-300')}>{i.overdue}</td>
                  <td className="px-4 text-right">{i.overlap && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">OVERLAP</span>}</td>
                </tr>))}
            </tbody>
          </table>
          </div>
        </Card>

      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Pending case ageing" className="min-w-0 overflow-hidden">
          <div className="h-48 min-w-0 w-full">
            <ResponsiveContainer>
              <BarChart data={Object.entries(d.ageing).map(([k, v]) => ({ bucket: k + ' days', count: v }))} margin={{ left: -20, top: 6 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="bucket" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="count" name="Open cases" radius={[5, 5, 0, 0]}>
                  {['#22c55e', '#eab308', '#f97316', '#dc2626'].map((c, i) => <Cell key={i} fill={c} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Received vs disposed (last 6 months)" className="min-w-0 overflow-hidden">
          <div className="h-48 min-w-0 w-full">
            <ResponsiveContainer>
              <LineChart data={d.trend} margin={{ left: -20, top: 6 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="received" name="Received" stroke="#1d4ed8" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="disposed" name="Disposed" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Live activity" className="min-w-0 overflow-hidden">
          <ul className="min-w-0 space-y-3">
            {d.activity.map((a: any, i: number) => (
              <li key={i} className="flex min-w-0 gap-3 text-sm">
                <BureauBadge code={a.bureau} className="mt-0.5 h-fit" />
                <div className="min-w-0 flex-1 overflow-hidden">
                  <Link to={`/cases/${a.case_id}`} className="font-medium text-slate-800 hover:underline">{a.case_id}</Link>
                  <span className="ml-2 text-[11px] uppercase tracking-wide text-slate-400">{a.action_type.replace('_', ' ')}</span>
                  <div className="truncate text-xs text-slate-500">{a.remarks}</div>
                  <div className="truncate text-[11px] text-slate-400">{a.institution} Â· {ago(a.ts)}</div>
                </div>
              </li>))}
          </ul>
        </Card>
      </div>
    </div>
  )
}
