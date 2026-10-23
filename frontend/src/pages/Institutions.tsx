import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '../api'
import { Card, ErrorBox, Loading, RiskBadge, cx } from '../ui'

export default function Institutions() {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'risk' | 'open'>('risk')
  const nav = useNavigate()
  const { data, error, loading } = useApi<any>('/institutions' + (q ? `?q=${encodeURIComponent(q)}` : ''))
  return (
    <div className="mx-auto max-w-[1300px] space-y-4">
      <div><h1 className="text-xl font-bold tracking-tight">Institutions</h1>
        <p className="text-sm text-slate-500">Centralised profiles keyed by AICTE Permanent ID, with consolidated complaint history across all Bureaus.</p></div>
      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by institution name, city or AICTE ID…"
          className="w-full max-w-lg rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-navy-2" />
        <div className="flex rounded-lg bg-slate-200/70 p-1 text-sm">
          {([['risk', 'Highest risk'], ['open', 'Most open cases']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setSort(k)} className={cx('rounded-md px-3 py-1.5 font-medium', sort === k ? 'bg-white shadow-sm' : 'text-slate-500')}>{l}</button>))}
        </div>
      </div>
      <Card pad={false}>
        {loading && !data ? <Loading /> : error && !data ? <ErrorBox msg={error} /> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-400">
              <tr>{['Institution', 'AICTE ID', 'Region', 'Risk', 'Total', 'Open', 'Overdue', ''].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {[...data.items].sort((a: any, b: any) => sort === 'risk' ? b.risk - a.risk : b.open - a.open).map((i: any) => (
                <tr key={i.aicte_id} onClick={() => nav(`/institutions/${i.aicte_id}`)} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{i.name}</td>
                  <td className="num px-4 py-3 text-slate-500">{i.aicte_id}</td>
                  <td className="px-4 py-3 text-slate-600">{i.region}</td>
                  <td className="px-4 py-3"><RiskBadge score={i.risk} band={i.risk_band} /></td>
                  <td className="num px-4 py-3">{i.total}</td>
                  <td className="num px-4 py-3 font-semibold">{i.open}</td>
                  <td className={cx('num px-4 py-3 font-semibold', i.overdue ? 'text-red-600' : 'text-slate-300')}>{i.overdue}</td>
                  <td className="px-4 py-3">{i.in_overlap > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">OVERLAP</span>}</td>
                </tr>))}
            </tbody>
          </table>)}
      </Card>
    </div>
  )
}
