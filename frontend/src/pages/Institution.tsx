import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Building2, Mail, MapPin, Phone, Siren, User } from 'lucide-react'
import { useApi } from '../api'
import { BureauBadge, Card, ErrorBox, Loading, RISK_COLORS, RiskBadge, SlaChip, StatusChip, cx, fmtDate } from '../ui'

export default function Institution() {
  const { id } = useParams()
  const { data, error, loading } = useApi<any>(`/institutions/${id}`)
  if (loading && !data) return <Loading />
  if (error && !data) return <ErrorBox msg={error} />
  const { institution: i, cases, clusters, stats, risk } = data
  const active = clusters.filter((c: any) => c.status === 'OPEN' || c.status === 'LINKED')

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1300px] space-y-5">
      <Link to="/institutions" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={15} /> Institutions</Link>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
        <div className="flex min-w-0 w-full gap-4 lg:w-auto lg:flex-1">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-navy text-white"><Building2 size={26} /></div>
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-xl font-bold tracking-tight">{i.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
              <span className="num rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">AICTE ID {i.aicte_id}</span>
              <span>{i.type}</span><span>{i.region} Region</span><span>Est. {i.est_year}</span>
            </div>
            <div className="mt-3 grid min-w-0 gap-x-8 gap-y-1.5 text-sm text-slate-600 sm:grid-cols-2">
              <span className="flex min-w-0 items-start gap-2"><MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" /><span className="min-w-0 break-words">{i.address}</span></span>
              <span className="flex min-w-0 items-start gap-2"><User size={14} className="mt-0.5 shrink-0 text-slate-400" /><span className="min-w-0 break-words">{i.head_name}</span></span>
              <span className="flex min-w-0 items-start gap-2"><Phone size={14} className="mt-0.5 shrink-0 text-slate-400" /><span className="min-w-0 break-words">{i.phone}</span></span>
              <span className="flex min-w-0 items-start gap-2"><Mail size={14} className="mt-0.5 shrink-0 text-slate-400" /><span className="min-w-0 break-all">{i.email}</span></span>
            </div>
            <div className="mt-3 flex min-w-0 flex-wrap gap-1.5">{i.programmes.map((p: string) => <span key={p} className="max-w-full break-words rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">{p}</span>)}</div>
          </div>
        </div>
        <div className="grid w-full min-w-0 grid-cols-2 gap-3 text-center sm:grid-cols-4 lg:w-auto">
          {[['Total', stats.total, 'text-slate-800'], ['Open', stats.open, 'text-blue-700'], ['Overdue', stats.overdue, stats.overdue ? 'text-red-600' : 'text-slate-300'], ['Bureaus', stats.bureaus_involved.length, 'text-slate-800']].map(([l, v, c]: any) => (
            <div key={l} className="min-w-0 rounded-lg bg-slate-50 px-4 py-3"><div className={cx('num text-2xl font-bold', c)}>{v}</div><div className="text-[11px] uppercase tracking-wider text-slate-400">{l}</div></div>))}
        </div>
      </div>

      <Card title="Institution risk score" right={<span className="text-[11px] text-slate-400">volume + severity + repeat offences + overdue</span>}>
        <div className="grid min-w-0 items-center gap-6 md:grid-cols-12">
          <div className="min-w-0 md:col-span-3">
            <div className="flex items-end gap-2"><span className="num text-6xl font-extrabold leading-none" style={{ color: RISK_COLORS[risk.band] }}>{risk.score}</span><span className="pb-1.5 text-sm text-slate-400">/ 100</span></div>
            <div className="mt-2"><RiskBadge score={risk.score} band={risk.band} size="lg" /></div>
          </div>
          <ul className="grid min-w-0 gap-x-6 gap-y-3 md:col-span-9 md:grid-cols-2">
            {risk.breakdown.map((b: any) => {
              const r = b.points / b.max
              return (
                <li key={b.signal} className="min-w-0">
                  <div className="mb-1 flex min-w-0 items-baseline justify-between gap-2 text-sm"><span className="min-w-0 break-words font-medium text-slate-700">{b.label}</span>
                    <span className="num shrink-0 text-xs font-semibold text-slate-600">{b.points} <span className="font-normal text-slate-400">/ {b.max}</span></span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${r * 100}%`, background: RISK_COLORS[r >= 0.7 ? 'HIGH' : r >= 0.4 ? 'MEDIUM' : 'LOW'] }} /></div>
                  <div className="mt-0.5 break-words text-xs text-slate-500">{b.detail}</div>
                </li>)
            })}
          </ul>
        </div>
      </Card>

      {active.map((cl: any) => (
        <div key={cl.cluster_id} className="flex min-w-0 flex-wrap items-center gap-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="rounded-full bg-red-100 p-2 text-red-600"><Siren size={20} /></div>
          <div className="min-w-0 flex-1"><div className="font-bold text-red-700">Potential Overlapping Cases — Coordination Required</div>
            <div className="text-sm text-red-700/90">{cl.cases.length} cases handled in parallel by {cl.bureaus.join(', ')} · {Math.round(cl.score)}% match.</div></div>
          <Link to={`/overlaps?open=${cl.cluster_id}`} className="rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-red-700">Why flagged</Link>
        </div>))}

      <Card title="Consolidated complaint history — all Bureaus" pad={false}>
        <div className="w-full max-w-full overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-400">
              <tr>{['Case ID', 'Category', 'Handled by', 'Status', 'Timeline', 'Last action', 'Received'].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {cases.map((c: any) => (
                <tr key={c.case_id} className="hover:bg-slate-50/70">
                  <td className="whitespace-nowrap px-4 py-3"><Link to={`/cases/${c.case_id}`} className="font-semibold text-navy-2 hover:underline">{c.case_id}</Link></td>
                  <td className="px-4 py-3 text-slate-600">{c.category}</td>
                  <td className="px-4 py-3"><BureauBadge code={c.bureau} /></td>
                  <td className="px-4 py-3"><StatusChip status={c.status} /></td>
                  <td className="px-4 py-3"><SlaChip sla={c.sla} /></td>
                  <td className="max-w-[260px] truncate px-4 py-3 text-slate-500">{c.last_action}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fmtDate(c.received_on)}</td>
                </tr>))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
