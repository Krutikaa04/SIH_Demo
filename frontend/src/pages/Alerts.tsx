import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertOctagon, BellRing, Clock, GitMerge, Repeat2, TrendingUp } from 'lucide-react'
import { post, useApi } from '../api'
import { Card, ErrorBox, Loading, ago, cx } from '../ui'

const TABS = [['', 'All'], ['OVERLAP', 'Overlap'], ['ESCALATION', 'Escalations'], ['SLA_NEAR', 'Nearing timeline'], ['SLA_BREACH', 'Timeline breached'], ['PENDING_REMINDER', 'Reminders'], ['PING_PONG', 'Ping-pong']]
const ICON: any = { OVERLAP: GitMerge, SLA_NEAR: Clock, SLA_BREACH: AlertOctagon, ESCALATION: TrendingUp, PENDING_REMINDER: BellRing, PING_PONG: Repeat2 }

export default function Alerts() {
  const [type, setType] = useState('')
  const { data, error, loading, reload } = useApi<any>('/alerts?limit=200' + (type ? `&type=${type}` : ''))
  return (
    <div className="mx-auto max-w-[1000px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-xl font-bold tracking-tight">Alerts &amp; notifications</h1>
          <p className="text-sm text-slate-500">Overlap alerts and timeline warnings across all Bureaus.</p></div>
        <button onClick={async () => { await post('/alerts/read-all'); reload() }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50">Mark all read</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {TABS.map(([v, l]) => <button key={v} onClick={() => setType(v)} className={cx('rounded-full px-3.5 py-1.5 text-sm font-medium', type === v ? 'bg-navy text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50')}>{l}</button>)}
      </div>
      <Card pad={false}>
        {loading && !data ? <Loading /> : error && !data ? <ErrorBox msg={error} /> : (
          <ul className="divide-y divide-slate-100">
            {data.items.map((a: any) => {
              const Icon = ICON[a.type] || Clock
              const to = a.link
              return (
                <li key={a.id}>
                  <Link to={to} onClick={() => post(`/alerts/${a.id}/read`)} className="flex items-start gap-3.5 px-4 py-3.5 hover:bg-slate-50">
                    <span className={cx('mt-0.5 rounded-lg p-2', a.severity === 'HIGH' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600', a.read && 'opacity-50')}><Icon size={16} /></span>
                    <span className="min-w-0 flex-1">
                      <span className={cx('block text-sm', a.read ? 'text-slate-500' : 'font-semibold text-slate-900')}>{a.message}</span>
                      <span className="block truncate text-xs text-slate-500">{[a.institution_name, a.case_id].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">{ago(a.created_at)}</span>
                  </Link>
                </li>)
            })}
            {data.items.length === 0 && <li className="p-10 text-center text-slate-400">No alerts.</li>}
          </ul>)}
      </Card>
    </div>
  )
}
