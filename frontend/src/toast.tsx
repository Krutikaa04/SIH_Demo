import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, TrendingUp, X } from 'lucide-react'
import { api, getRole, on } from './api'
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
              <BureauBadge code={a.bureau} /> <span>×</span> <BureauBadge code={b.bureau} />
              <span className="ml-1">{Math.round(p.score)}% match</span>
            </div>
          </div>),
        to: `/overlaps?open=${p.cluster_id}`, cta: 'Review overlap',
      }, 14000)
    } catch { /* ignore */ }
  }, [push])

  // The server broadcasts to every client; show the red toast only to the roles the overlap concerns.
  useEffect(() => on('overlap.detected', (d) => {
    if (!d.pair_id) return
    const me = getRole()
    const targets: string[] = d.targets || []
    if (me.role === 'REGIONAL' ? d.region !== me.region : me.role !== 'SENIOR' && targets.length > 0 && !targets.includes(me.role)) return
    overlapToast(d.pair_id)
  }), [overlapToast])
  useEffect(() => on('sla.escalated', (d) => {
    const me = getRole()
    if (me.role === 'REGIONAL') return // regional users get region-scoped alerts in the bell instead
    if (me.role !== 'SENIOR' && d.bureaus && !d.bureaus.includes(me.role)) return
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
      <div className="pointer-events-none fixed right-4 top-[72px] z-50 flex w-[380px] max-w-[92vw] flex-col gap-3" aria-live="polite">
        {toasts.map((t) => {
          const tone = t.kind === 'overlap' ? { bar: 'bg-red-600', ink: 'text-red-700', chip: 'bg-red-50 text-red-600 pulse-red', btn: 'bg-red-600 hover:bg-red-700' }
            : t.kind === 'warn' ? { bar: 'bg-orange-500', ink: 'text-orange-700', chip: 'bg-orange-50 text-orange-600', btn: 'bg-orange-600 hover:bg-orange-700' }
            : { bar: 'bg-emerald-600', ink: 'text-slate-900', chip: 'bg-emerald-50 text-emerald-600', btn: 'bg-navy hover:bg-navy-2' }
          return (
            <div key={t.id} role="status" className="toast-in pointer-events-auto relative overflow-hidden rounded-xl border border-line bg-sheet shadow-lg">
              <span className={`absolute inset-y-0 left-0 w-1 ${tone.bar}`} />
              <div className="flex items-start gap-3 py-3.5 pl-5 pr-3.5">
                <div className={`mt-0.5 rounded-full p-1.5 ${tone.chip}`}>
                  {t.kind === 'overlap' ? <AlertTriangle size={16} /> : t.kind === 'warn' ? <TrendingUp size={16} /> : <CheckCircle2 size={16} />}
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <div className={`font-display text-[1.0625rem] font-semibold leading-snug ${tone.ink}`}>{t.title}</div>
                  <div className="mt-1">{t.body}</div>
                  {t.to && (
                    <button onClick={() => { nav(t.to!); dismiss(t.id) }} className={`btn btn-sm mt-3 text-white ${tone.btn}`}>
                      {t.cta || 'Open'}
                    </button>)}
                </div>
                <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="rounded p-0.5 text-slate-400 hover:text-slate-700"><X size={16} /></button>
              </div>
            </div>)
        })}
      </div>
    </Ctx.Provider>
  )
}
