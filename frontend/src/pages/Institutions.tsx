import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Building2, Search } from 'lucide-react'
import { useApi } from '../api'
import { Card, EmptyState, ErrorBox, Loading, PageHeader, RiskBadge, Segmented, cx } from '../ui'

export default function Institutions() {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'risk' | 'open'>('risk')
  const nav = useNavigate()
  const { data, error, loading } = useApi<any>('/institutions' + (q ? `?q=${encodeURIComponent(q)}` : ''))
  const items = data ? [...data.items].sort((a: any, b: any) => sort === 'risk' ? b.risk - a.risk : b.open - a.open) : []
  return (
    <div className="mx-auto max-w-[1240px]">
      <PageHeader eyebrow="Look up" title="Institutions"
        subtitle="Every college has one profile, found by its AICTE ID, showing all complaints about it across every Bureau." />
      <div className="rise rise-1 mb-5 flex flex-wrap items-center gap-3">
        <label className="relative block min-w-[260px] max-w-lg flex-1">
          <span className="sr-only">Search institutions</span>
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, city or AICTE ID" className="field !rounded-full !py-2.5 !pl-10" />
        </label>
        <Segmented label="Order" value={sort} onChange={setSort} options={[['risk', 'Highest risk first'], ['open', 'Most open cases first']] as const} />
      </div>
      <Card pad={false} className="rise rise-2 overflow-hidden">
        {loading && !data ? <div className="p-5"><Loading /></div> : error && !data ? <ErrorBox msg={error} /> : items.length === 0 ? (
          <EmptyState icon={Building2} title="No institution found">Check the spelling, or try the city or the AICTE ID.</EmptyState>
        ) : (<>
          <ul className="divide-y divide-line md:hidden">
            {items.map((i: any) => (
              <li key={i.aicte_id}><Link to={`/institutions/${i.aicte_id}`} className="block px-4 py-3.5 active:bg-slate-100">
                <div className="font-medium text-slate-900">{i.name}</div>
                <div className="mt-1 flex items-center gap-3 text-[13px] text-slate-500"><RiskBadge score={i.risk} band={i.risk_band} /><span>{i.open} open</span>{i.overdue > 0 && <span className="font-semibold text-red-600">{i.overdue} past due</span>}</div>
              </Link></li>))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-100/60 text-left">
                <tr>{['Institution', 'Region', 'Risk', 'All cases', 'Open', 'Past due', ''].map((h, n) => <th key={n} className={cx('eyebrow px-4 py-2.5', n === 0 && 'px-5')}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {items.map((i: any) => (
                  <tr key={i.aicte_id} onClick={() => nav(`/institutions/${i.aicte_id}`)} className="group cursor-pointer transition hover:bg-slate-50">
                    <td className="px-5 py-3"><div className="font-medium text-slate-900 group-hover:underline">{i.name}</div><div className="num text-[12px] text-slate-400">{i.aicte_id}</div></td>
                    <td className="px-4 py-3 text-slate-600">{i.region}</td>
                    <td className="px-4 py-3"><RiskBadge score={i.risk} band={i.risk_band} /></td>
                    <td className="num px-4 py-3 text-slate-600">{i.total}</td>
                    <td className="num px-4 py-3 font-semibold">{i.open}</td>
                    <td className={cx('num px-4 py-3 font-semibold', i.overdue ? 'text-red-600' : 'text-slate-300')}>{i.overdue}</td>
                    <td className="px-4 py-3">{i.in_overlap > 0 && <span className="rounded-[4px] border border-indigo-200 bg-indigo-50 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-indigo-700">Overlap</span>}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        </>)}
      </Card>
    </div>
  )
}
