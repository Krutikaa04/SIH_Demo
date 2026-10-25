import { Link } from 'react-router-dom'
import { useApi, useRole } from '../api'
import { BureauBadge, Card, ErrorBox, fmtDate } from '../ui'

type Concern = {
  category: string
  elapsed_days: number
  current: { case_id: string; bureau: string; received_on: string; url: string }
  previous: {
    case_id: string; bureau: string; disposed_on: string; outcome: string | null; url: string
    final_action: { seq: number; at: string; actor: string; remarks: string; hash: string }
  }
}
type Aftercare = {
  institution: { aicte_id: string; region: string }
  scope: { role: string; region: string }
  items: Concern[]
  total: number
  summary: { excluded_records: number }
  limitation: string
}

export default function InstitutionAftercare({ institutionId }: { institutionId: string }) {
  const me = useRole()
  return <AftercareView key={`${institutionId}:${me.role}:${me.region}`} institutionId={institutionId}
    role={me.role} region={me.role === 'REGIONAL' ? me.region : ''} />
}

function AftercareView({ institutionId, role, region }: { institutionId: string; role: string; region: string }) {
  const { data, error } = useApi<Aftercare>(`/institutions/${encodeURIComponent(institutionId)}/aftercare`)
  const matches = data?.institution.aicte_id === institutionId && data.scope.role === role &&
    data.scope.region === region && (role !== 'REGIONAL' || data.institution.region === region)
  return (
    <Card title="Check what happened after closure" subtitle="New open complaints in a category that had an earlier recorded closure.">
      {role === 'REGIONAL' && !region ? <ErrorBox msg="Choose a region to view institution aftercare." />
        : error ? <ErrorBox msg={error} />
        : !matches ? <p className="text-sm text-slate-500" role="status">Loading institution aftercare…</p>
        : <div className="space-y-4">
          <p className="text-[13px] text-slate-600">{data.limitation}</p>
          {data.items.length === 0 ? <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-600">
            No open complaint has a valid earlier closure in the same category.</p>
            : <ul className="space-y-3">
              {data.items.map((item) => (
                <li key={item.current.case_id} className="min-w-0 rounded-lg border border-amber-200 bg-amber-50/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><p className="text-sm font-semibold text-amber-950">New concern after closure</p>
                      <p className="mt-1 text-sm text-slate-700">{item.category}</p></div>
                    <span className="text-xs font-semibold text-amber-900">Received {item.elapsed_days} calendar {item.elapsed_days === 1 ? 'day' : 'days'} later</span>
                  </div>
                  <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                    <div className="min-w-0"><p className="mb-1 text-xs text-slate-500">Earlier complaint · closed {fmtDate(item.previous.disposed_on)}</p>
                      <div className="flex flex-wrap items-center gap-2"><BureauBadge code={item.previous.bureau} />
                        <Link className="case-id break-all text-navy-2 underline" to={item.previous.url}>{item.previous.case_id}</Link></div>
                      <p className="mt-2 break-words text-[13px] text-slate-700">{item.previous.outcome || 'No separate outcome note recorded.'}</p>
                      <p className="mt-2 break-words text-xs text-slate-500">Final action #{item.previous.final_action.seq} · {item.previous.final_action.actor}: {item.previous.final_action.remarks || 'No action note recorded.'}</p>
                    </div>
                    <div className="min-w-0"><p className="mb-1 text-xs text-slate-500">Current complaint · received {fmtDate(item.current.received_on)}</p>
                      <div className="flex flex-wrap items-center gap-2"><BureauBadge code={item.current.bureau} />
                        <Link className="case-id break-all text-navy-2 underline" to={item.current.url}>{item.current.case_id}</Link></div>
                      <p className="mt-2 text-[13px] text-slate-600">Review both records before deciding whether any further follow-up is needed.</p>
                    </div>
                  </div>
                </li>))}
            </ul>}
          {data.summary.excluded_records > 0 && <p className="text-xs text-slate-500">{data.summary.excluded_records} {data.summary.excluded_records === 1 ? 'record was' : 'records were'} excluded because dates or final closure evidence could not be confirmed.</p>}
        </div>}
    </Card>
  )
}
