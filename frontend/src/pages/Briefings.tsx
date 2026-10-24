import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileText, Printer, Building2, ShieldAlert, Users, ArrowUpRight, CheckCircle2 } from 'lucide-react'
import { useApi } from '../api'
import { Card, Loading, ErrorBox, cx } from '../ui'

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
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 print:hidden">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-navy text-white shadow-sm">
            <FileText size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Executive Briefing &amp; Citations</h1>
            <p className="text-xs text-slate-500">Synthesized multi-bureau intelligence grounded in verified dockets</p>
          </div>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
          <Printer size={16} /> Print Official Brief
        </button>
      </div>

      {loading && !briefing ? (
        <Loading />
      ) : error ? (
        <ErrorBox msg={error} />
      ) : (
        <div className="space-y-5">
          {/* Executive Overview Banner */}
          <div className="rounded-xl border border-slate-200 bg-gradient-to-r from-slate-900 to-navy p-5 text-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
                Official Directorate Briefing
              </span>
              <span className="text-xs text-slate-300 font-medium">
                Anchor Date: {briefing.generated_at}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <div className="text-[11px] text-slate-400">Total Grievances</div>
                <div className="num mt-0.5 text-2xl font-bold">{briefing.total_cases}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Active / Pending</div>
                <div className="num mt-0.5 text-2xl font-bold text-cyan-300">{briefing.pending_cases}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Statutory SLA Overdue</div>
                <div className="num mt-0.5 text-2xl font-bold text-red-400">{briefing.overdue_cases}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Coordination Taskforces</div>
                <div className="num mt-0.5 text-2xl font-bold text-amber-300">{briefing.active_rooms}</div>
              </div>
            </div>
          </div>

          {/* Structured Sections with Clickable Citations */}
          {briefing.sections.map((sec: any) => (
            <Card key={sec.id} title={sec.title} right={sec.badge && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-700">{sec.badge}</span>}>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {renderCitations(sec.content, briefing.citations)}
              </div>
            </Card>
          ))}

          {/* Verification Footnote */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
            <div className="flex items-center gap-2 font-semibold text-slate-700">
              <CheckCircle2 size={15} className="text-emerald-600" /> Grounded Evidence Guarantee
            </div>
            <p className="mt-1 leading-relaxed">
              Every numerical claim and institution alert above is deterministically computed from underlying
              complaint dockets. Click any blue bracketed docket chip (e.g. <span className="font-mono text-blue-600 font-bold">[CASE-...]</span>) to inspect its full evidence dossier and hash-chained action history.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
