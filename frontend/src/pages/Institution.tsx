import { Link, useParams } from 'react-router-dom'
import { Building2, FileSpreadsheet, Mail, MapPin, Phone, Siren, User } from 'lucide-react'
import { download, useApi, useRole } from '../api'
import InstitutionAftercare from '../components/InstitutionAftercare'
import { BureauBadge, Card, ErrorBox, Loading, RISK_COLORS, RiskBadge, SlaChip, Stat, StatusChip, cx, fmtDate } from '../ui'

export default function Institution() {
  const { id } = useParams()
  const me = useRole()
  if (me.role === 'REGIONAL' && !me.region) return <ErrorBox msg="Choose a region to view this institution." />
  return <InstitutionProfile key={`${id}:${me.role}:${me.region}`} institutionId={id || ''}
    region={me.role === 'REGIONAL' ? me.region : ''} />
}

function InstitutionProfile({ institutionId, region }: { institutionId: string; region: string }) {
  const { data, error, loading } = useApi<any>(`/institutions/${encodeURIComponent(institutionId)}`)
  if (loading && !data) return <Loading />
  if (error && !data) return <ErrorBox msg={error} />
  if (!data || data.institution.aicte_id !== institutionId || (region && data.institution.region !== region)) return <Loading />
  const { institution: i, cases, clusters, stats, risk } = data
  const active = clusters.filter((c: any) => c.status === 'OPEN' || c.status === 'LINKED')

  return (
    <div className="mx-auto max-w-[1240px] space-y-6">
      <Link to="/institutions" className="rise inline-flex items-center gap-1 text-[13px] font-medium text-slate-500 hover:text-slate-900">← All institutions</Link>

      <header className="rise grid gap-6 lg:grid-cols-[1fr_auto] lg:items-start">
        <div className="flex gap-4">
          <div className="hidden h-14 w-14 shrink-0 place-items-center rounded-xl bg-navy text-paper sm:grid"><Building2 size={26} /></div>
          <div className="min-w-0">
            <div className="eyebrow">AICTE ID <span className="font-mono normal-case tracking-normal text-slate-700">{i.aicte_id}</span> · {i.type} · est. {i.est_year}</div>
            <h1 className="font-display mt-1 text-[1.875rem] font-semibold leading-[1.1] text-slate-900 md:text-[2.25rem]">{i.name}</h1>
            <div className="mt-3 grid gap-x-8 gap-y-1.5 text-[14px] text-slate-600 sm:grid-cols-2">
              <span className="flex items-center gap-2"><MapPin size={14} className="shrink-0 text-slate-400" /> {i.address}, {i.region} region</span>
              <span className="flex items-center gap-2"><User size={14} className="shrink-0 text-slate-400" /> {i.head_name}</span>
              <span className="flex items-center gap-2"><Phone size={14} className="shrink-0 text-slate-400" /> {i.phone}</span>
              <span className="flex items-center gap-2"><Mail size={14} className="shrink-0 text-slate-400" /> {i.email}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">{i.programmes.map((p: string) => <span key={p} className="rounded-full border border-line bg-sheet px-2.5 py-0.5 text-xs text-slate-600">{p}</span>)}</div>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <Stat small label="All cases" value={stats.total} />
          <Stat small label="Open" value={stats.open} tone="blue" />
          <Stat small label="Past due" value={stats.overdue} tone={stats.overdue ? 'red' : 'ink'} />
          <Stat small label="Bureaus" value={stats.bureaus_involved.length} />
        </div>
      </header>

      {active.map((cl: any) => (
        <div key={cl.cluster_id} className="rise rise-1 flex flex-wrap items-center gap-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-red-100 text-red-600"><Siren size={20} /></div>
          <div className="min-w-0 flex-1 basis-64"><div className="font-display text-[1.1875rem] font-semibold text-red-800">Potential Overlapping Cases — Coordination Required</div>
            <div className="text-[14px] text-red-800/90">{cl.cases.length} cases are being handled in parallel by {cl.bureaus.join(', ')} ({Math.round(cl.score)}% match).</div></div>
          <Link to={`/overlaps?open=${cl.cluster_id}`} className="btn btn-danger">See why</Link>
        </div>))}

      <Card className="rise rise-2" title="Risk score" subtitle="Built from how many complaints, how serious, how often they repeat, and how many are overdue.">
        <div className="grid items-center gap-8 md:grid-cols-12">
          <div className="md:col-span-3">
            <div className="flex items-end gap-2"><span className="font-display num text-[4.5rem] font-semibold leading-none" style={{ color: RISK_COLORS[risk.band] }}>{risk.score}</span><span className="pb-2 text-sm text-slate-400">out of 100</span></div>
            <div className="mt-3"><RiskBadge score={risk.score} band={risk.band} size="lg" /></div>
          </div>
          <ul className="grid gap-x-8 gap-y-4 md:col-span-9 md:grid-cols-2">
            {risk.breakdown.map((b: any) => {
              const r = b.points / b.max
              return (
                <li key={b.signal}>
                  <div className="mb-1 flex items-baseline justify-between text-sm"><span className="font-semibold text-slate-800">{b.label}</span>
                    <span className="num text-xs font-semibold text-slate-500">{b.points} <span className="font-normal text-slate-400">of {b.max}</span></span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full" style={{ width: `${r * 100}%`, background: RISK_COLORS[r >= 0.7 ? 'HIGH' : r >= 0.4 ? 'MEDIUM' : 'LOW'] }} /></div>
                  <div className="mt-1 text-[12.5px] text-slate-500">{b.detail}</div>
                </li>)
            })}
          </ul>
        </div>
      </Card>

      <InstitutionAftercare institutionId={i.aicte_id} />

      <Card className="rise rise-3" title="Every complaint about this institution" subtitle="All Bureaus, newest first" pad={false}
        right={<button onClick={() => download(`/institutions/${i.aicte_id}/history.csv`, `${i.aicte_id}_history.csv`)} className="btn btn-ghost btn-sm"><FileSpreadsheet size={13} className="text-emerald-600" /> Download</button>}>
        <ul className="mt-3 divide-y divide-line border-t border-line md:hidden">
          {cases.map((c: any) => (
            <li key={c.case_id}><Link to={`/cases/${c.case_id}`} className="block px-4 py-3">
              <div className="flex items-center gap-2"><span className="case-id text-navy-2">{c.case_id}</span><BureauBadge code={c.bureau} /><StatusChip status={c.status} /></div>
              <div className="mt-1 text-[13px] text-slate-500">{c.category}</div></Link></li>))}
        </ul>
        <div className="mt-3 hidden overflow-x-auto border-t border-line md:block">
          <table className="w-full text-sm">
            <thead className="bg-slate-100/60 text-left">
              <tr>{['Case', 'Category', 'Handled by', 'Status', 'Time left', 'Last action', 'Received'].map((h, n) => <th key={h} className={cx('eyebrow px-4 py-2.5', n === 0 && 'px-5')}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {cases.map((c: any) => (
                <tr key={c.case_id} className="transition hover:bg-slate-50">
                  <td className="whitespace-nowrap px-5 py-3"><Link to={`/cases/${c.case_id}`} className="case-id text-navy-2 hover:underline">{c.case_id}</Link></td>
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
