import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, TrendingUp, X } from 'lucide-react'
import { api, on } from './api'
import { BureauBadge } from './ui'

type Toast = { id: number; kind: 'overlap' | 'info' | 'warn'; title: string; body?: ReactNode; to?: string; cta?: string; band?: string }
const Ctx = createContext<any>(null)
export const useToast = () => useContext(Ctx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seen = useRef(new Set<string>())
  const nav = useNavigate()
  const counter = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const push = useCallback((t: Omit<Toast, 'id'>, ms = 10000) => {
    const id = counter.current++
    setToasts((l) => [...l.slice(-3), { ...t, id }])
    setTimeout(() => dismiss(id), ms)
  }, [dismiss])

  /** Show the red overlap alert for a detected pair. De-duplicated, so SSE + API response never double-fire. */
  const overlapToast = useCallback(async (pairId: string) => {
    if (seen.current.has(pairId)) return
    seen.current.add(pairId)
    try {
      const p = await api('/overlaps/' + pairId)
      const [a, b] = p.cases
      push({
        kind: 'overlap', band: p.band,
        title: p.headline,
        body: (
          <div className="space-y-1.5">
            <div className="font-medium text-slate-800">{a.institution.name}</div>
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <BureauBadge code={a.bureau} /> <span aria-hidden="true">×</span> <BureauBadge code={b.bureau} />
              <span className="ml-1">{Math.round(p.score)}% match</span>
            </div>
          </div>),
        to: `/overlaps?open=${p.cluster_id}`, cta: 'Review overlap',
      }, 14000)
    } catch { /* ignore */ }
  }, [push])

  useEffect(() => on('overlap.detected', (d) => d.pair_id && overlapToast(d.pair_id)), [overlapToast])
  useEffect(() => on('sla.escalated', (d) => {
    const esc = (d.escalated || 0) + (d.severe || 0)
    if (!esc && !d.near) return
    push({
      kind: 'warn', title: esc ? `SLA engine auto-escalated ${esc} case${esc !== 1 ? 's' : ''}` : 'Timeline warnings raised',
      body: <span className="text-slate-600">{esc ? `Prescribed timelines exceeded. ` : ''}{d.near ? `${d.near} more now nearing their timeline.` : ''}</span>,
      to: esc ? '/cases?status=Escalated' : '/cases?status=Pending', cta: esc ? 'View escalated cases' : 'View cases',
    }, 12000)
  }), [push])

  return (
    <Ctx.Provider value={{ push, overlapToast }}>
      {children}
<div
  role="region"
  aria-label="Notifications"
  className="pointer-events-none fixed right-4 top-16 z-50 flex w-[380px] max-w-[92vw] flex-col gap-3"
>        {toasts.map((t) => (
          <div key={t.id} role={t.kind === 'overlap' ? 'alert' : 'status'} aria-live={t.kind === 'overlap' ? 'assertive' : 'polite'} aria-atomic="true"
            className={`toast-in pointer-events-auto overflow-hidden rounded-xl bg-white shadow-xl ring-1 ${
            t.kind === 'overlap' ? 'ring-red-300' : t.kind === 'warn' ? 'ring-orange-300' : 'ring-slate-200'}`}>
            <div className={`flex items-start gap-3 p-3.5 ${t.kind === 'overlap' ? 'border-l-4 border-red-600' : t.kind === 'warn' ? 'border-l-4 border-orange-500' : 'border-l-4 border-emerald-500'}`}>
              <div aria-hidden="true" className={`mt-0.5 rounded-full p-1.5 ${t.kind === 'overlap' ? 'bg-red-100 text-red-600 pulse-red' : t.kind === 'warn' ? 'bg-orange-100 text-orange-600' : 'bg-emerald-100 text-emerald-600'}`}>
                {t.kind === 'overlap' ? <AlertTriangle size={16} /> : t.kind === 'warn' ? <TrendingUp size={16} /> : <CheckCircle2 size={16} />}
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <div className={`font-semibold leading-snug ${t.kind === 'overlap' ? 'text-red-700' : t.kind === 'warn' ? 'text-orange-700' : 'text-slate-800'}`}>{t.title}</div>
                <div className="mt-1">{t.body}</div>
                {t.to && (
                  <button type="button" onClick={() => { nav(t.to!); dismiss(t.id) }}
                    className={`mt-2.5 rounded-md px-3 py-1 text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${t.kind === 'warn' ? 'bg-orange-600 hover:bg-orange-700' : 'bg-red-600 hover:bg-red-700'}`}>
                    {t.cta || 'Open'}
                  </button>)}
              </div>
              <button type="button" onClick={() => dismiss(t.id)} aria-label={`Dismiss notification: ${t.title}`}
                className="rounded-md text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
