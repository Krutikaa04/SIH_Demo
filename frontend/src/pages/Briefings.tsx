import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileText, Printer, Building2, ShieldAlert, Users, ArrowUpRight, CheckCircle2 } from 'lucide-react'
import { useApi } from '../api'
import { Card, Loading, ErrorBox, PageHeader, cx } from '../ui'

export default function Briefings() {
  const nav = useNavigate()
  const { data: briefing, loading, error } = useApi<any>('/briefings/executive')

  // Render text with clickable citation chips
  const renderCitations = (text: string, citations: Record<string, string> = {}) => {
    if (!text) return null
    // Match tokens like [CASE-1234] or [ROOM-0001] or [1-4520311]
    const parts = text.split(/(\[[A-Za-z0-9\-_]+\])/g)

    return parts.map((part, i) => {
      const link = citations[part]
      if (link) {
        return (
          <button
            key={i}
            onClick={() => nav(link)}
            title={`View evidence: ${part}`}
            className="inline-flex items-center gap-0.5 rounded-md bg-blue-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-blue-700 ring-1 ring-blue-200 transition hover:bg-blue-100 hover:text-blue-900 mx-0.5 align-baseline">
            {part} <ArrowUpRight size={11} className="inline opacity-70" />
          </button>
        )
      }
      return <span key={i}>{part}</span>
    })
  }

  return (
    <div className="mx-auto max-w-[1000px] space-y-5 print:m-0 print:p-0">
      <div className="print:hidden">
        <PageHeader eyebrow="For the leadership" title="Executive briefing"
          subtitle="Where the complaints stand, in plain words. Every figure is worked out from real cases, and the highlighted case numbers open the evidence."
          actions={<button onClick={() => window.print()} className="btn btn-ghost"><Printer size={16} /> Print this briefing</button>} />
      </div>

      {loading && !briefing ? (
        <Loading />
      ) : error ? (
        <ErrorBox msg={error} />
      ) : (
        <div className="space-y-5">
          {/* Overview */}
          <div className="rise rounded-xl bg-navy p-6 text-paper shadow-md">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/15 pb-3">
              <span className="text-[11px] font-bold uppercase tracking-[.14em] text-amber-300">Official briefing</span>
              <span className="text-xs text-paper/70">As of {briefing.generated_at}</span>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-4">
              {[['Complaints received', briefing.total_cases, 'text-paper'], ['Still open', briefing.pending_cases, 'text-sky-200'],
                ['Past their due date', briefing.overdue_cases, 'text-red-300'], ['Coordination rooms', briefing.active_rooms, 'text-amber-200']].map(([l, v, c]: any) => (
                <div key={l}><div className="text-[12px] text-paper/70">{l}</div><div className={'font-display num mt-1 text-[2.25rem] font-semibold leading-none ' + c}>{v}</div></div>))}
            </div>
          </div>

          {/* Structured Sections with Clickable Citations */}
          {briefing.sections.map((sec: any) => (
            <Card key={sec.id} title={sec.title} right={sec.badge && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-700">{sec.badge}</span>}>
              <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-700">
                {renderCitations(sec.content, briefing.citations)}
              </div>
            </Card>
          ))}

          {/* Verification footnote */}
          <div className="rounded-xl border border-dashed border-slate-300 p-4 text-[13px] text-slate-500">
            <div className="flex items-center gap-2 font-semibold text-slate-700"><CheckCircle2 size={15} className="text-emerald-600" /> Every figure can be checked</div>
            <p className="mt-1 leading-relaxed">Numbers and warnings above are counted directly from the cases, not estimated. Select any highlighted case number, such as <span className="font-mono font-semibold text-blue-700">[CASE-...]</span>, to see the case and its full history.</p>
          </div>
        </div>
      )}
    </div>
  )
}
