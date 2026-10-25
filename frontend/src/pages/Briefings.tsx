import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, CheckCircle2, ListChecks, Printer } from 'lucide-react'
import { useApi, useRole } from '../api'
import { Card, EmptyState, ErrorBox, Loading, PageHeader, cx } from '../ui'

type Evidence = { kind: string; label: string; url: string }
type AgendaItem = {
  id: string
  rank: number
  title: string
  owner: { bureau: string | null; label: string }
  urgency: 'OVERDUE' | 'DUE_SOON' | 'REVIEW'
  reason: string
  counts: { open_cases: number; overdue_cases: number; due_soon_cases: number; earliest_due: string | null }
  evidence: Evidence[]
  next_action: { label: string; url: string }
}
type Briefing = {
  generated_at: string
  scope: string
  region: string
  total_cases: number
  pending_cases: number
  overdue_cases: number
  active_rooms: number
  action_agenda: AgendaItem[]
  agenda_method: string
  sections: { id: string; title: string; badge: string; content: string }[]
  citations: Record<string, string>
}

const urgency = {
  OVERDUE: { label: 'Past due', tone: 'border-red-200 bg-red-50 text-red-800' },
  DUE_SOON: { label: 'Due within 7 days', tone: 'border-amber-200 bg-amber-50 text-amber-800' },
  REVIEW: { label: 'Needs review', tone: 'border-slate-200 bg-slate-50 text-slate-700' },
}

function CitationText({ text, citations }: { text: string; citations: Record<string, string> }) {
  return <>{text.split(/(\[[^\[\]\n]+\])/g).map((part, i) => citations[part]
    ? <Link key={i} to={citations[part]} title={`View evidence: ${part}`}
        className="mx-0.5 inline-flex max-w-full items-center gap-0.5 rounded-md bg-blue-50 px-1.5 py-0.5 align-baseline font-mono text-[11px] font-semibold text-blue-700 ring-1 ring-blue-200 transition hover:bg-blue-100 hover:text-blue-900">
        <span className="break-all">{part}</span><ArrowUpRight size={11} className="shrink-0 opacity-70" />
      </Link>
    : <span key={i}>{part}</span>)}</>
}

function ActionItem({ action, hidden }: { action: AgendaItem; hidden?: boolean }) {
  const badge = urgency[action.urgency]
  return (
    <li className={cx('p-5 print:break-inside-avoid', hidden && 'hidden print:block')}>
      <div className="flex items-start gap-3">
        <span className="font-display num mt-0.5 w-6 shrink-0 text-xl font-semibold leading-none text-slate-300">{String(action.rank).padStart(2, '0')}</span>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-lg font-semibold leading-snug text-slate-900">{action.title}</h3>
            <span className={cx('rounded-full border px-2 py-0.5 text-[11px] font-bold', badge.tone)}>{badge.label}</span>
          </div>
          <p className="text-[13px] leading-relaxed text-slate-600">{action.reason}</p>
          <div className="text-[12px] text-slate-500"><span className="font-semibold text-slate-700">Who can take this forward:</span> {action.owner.label}</div>
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Supporting evidence">
            {action.evidence.map((item) => <Link key={`${item.kind}:${item.label}`} to={item.url}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-slate-50 px-2 py-1 font-mono text-[11px] text-navy hover:border-slate-400 hover:bg-sheet">
              <span className="break-all">{item.label}</span><ArrowUpRight size={11} className="shrink-0" />
            </Link>)}
          </div>
          <Link to={action.next_action.url} className="btn btn-ghost btn-sm print:hidden">
            {action.next_action.label}<ArrowUpRight size={14} />
          </Link>
        </div>
      </div>
    </li>
  )
}

export default function Briefings() {
  const { data: briefing, loading, error } = useApi<Briefing>('/briefings/executive')
  const role = useRole()
  const [showAll, setShowAll] = useState(false)
  if (loading && !briefing) return <Loading />
  if (error) return <ErrorBox msg={error} />
  const expectedRegion = role.role === 'REGIONAL' ? role.region : ''
  if (!briefing || (role.role === 'REGIONAL' && !role.region) || briefing.region !== expectedRegion) return <Loading />
  const actions = briefing.action_agenda || []
  const figures = [
    { label: 'Complaints received', value: briefing.total_cases, tone: 'text-snow' },
    { label: 'Still open', value: briefing.pending_cases, tone: 'text-[#a5e9ff]' },
    { label: 'Past their due date', value: briefing.overdue_cases, tone: 'text-[#ff9aa4]' },
    { label: 'Rooms still open', value: briefing.active_rooms, tone: 'text-[#ffe29a]' },
  ]

  return (
    <div className="mx-auto max-w-[1000px] space-y-5 print:m-0 print:p-0">
      <div className="print:hidden">
        <PageHeader eyebrow="Coordination and oversight" title="Executive briefing"
          subtitle="Where complaints stand and what needs attention next. Open the linked evidence, then take the next step in the usual workflow."
          actions={<button onClick={() => window.print()} className="btn btn-ghost"><Printer size={16} /> Print this briefing</button>} />
      </div>

      <div className="mesh rise overflow-hidden rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/15 pb-3">
          <span className="text-[11px] font-bold uppercase tracking-[.14em] text-[#ffd36b]">{briefing.scope} · Prototype briefing</span>
          <span className="text-xs text-snow/70">As of {briefing.generated_at}</span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-4">
          {figures.map((figure) => <div key={figure.label}>
            <div className="text-[12px] text-snow/70">{figure.label}</div>
            <div className={cx('font-display num mt-1 text-[2.25rem] font-semibold leading-none', figure.tone)}>{figure.value}</div>
          </div>)}
        </div>
      </div>

      <Card pad={false} title={<span className="flex items-center gap-2"><ListChecks size={18} className="text-saffron" /> What to take forward</span>}
        subtitle="Suggestions from the case records. Each step still needs the responsible official's review."
        right={<span className="num whitespace-nowrap text-xs text-slate-500">{actions.length} {actions.length === 1 ? 'review' : 'reviews'}</span>}>
        {actions.length ? <>
          <ol className="divide-y divide-line border-t border-line">
            {actions.map((action, i) => <ActionItem key={action.id} action={action} hidden={!showAll && i >= 6} />)}
          </ol>
          {actions.length > 6 && <div className="border-t border-line px-5 py-3 print:hidden">
            <button onClick={() => setShowAll((v) => !v)} className="text-sm font-semibold text-navy hover:underline">
              {showAll ? 'Show the first 6' : `Show all ${actions.length} reviews`}
            </button>
          </div>}
        </> : <EmptyState icon={CheckCircle2} title="No coordination reviews flagged">
          No unresolved cross-Bureau work, open room decisions, merged-case follow-ups or repeated transfers need review in this scope.
        </EmptyState>}
        <details className="border-t border-line px-5 py-3 text-[12px] text-slate-500 print:hidden">
          <summary className="cursor-pointer font-semibold text-slate-700">How this list is ordered</summary>
          <p className="mt-2 leading-relaxed">{briefing.agenda_method}</p>
        </details>
      </Card>

      {briefing.sections.map((section) => <Card key={section.id} title={section.title}
        right={section.badge && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-700">{section.badge}</span>}>
        <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-700">
          <CitationText text={section.content} citations={briefing.citations} />
        </div>
      </Card>)}

      <div className="rounded-xl border border-dashed border-slate-300 p-4 text-[13px] text-slate-500">
        <div className="flex items-center gap-2 font-semibold text-slate-700"><CheckCircle2 size={15} className="text-emerald-600" /> Check the evidence before acting</div>
        <p className="mt-1 leading-relaxed">Counts come from stored complaint records. Institution risk is a transparent heuristic, and the action list is a rule-based review aid. Timelines are configured for this prototype; suggestions do not change a case or record a decision.</p>
      </div>
    </div>
  )
}
