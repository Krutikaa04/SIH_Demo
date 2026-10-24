import { ReactNode, useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'

export const cx = (...a: any[]) => a.filter(Boolean).join(' ')

export const BUREAU_COLORS: Record<string, string> = {
  RB: '#1d4ed8', PGRC: '#7c3aed', AB: '#0f766e', LC: '#92400e', VIG: '#be123c', SENIOR: '#0b2a4a',
}
export const STATUS_COLORS: Record<string, string> = {
  'Received / Pending Info': '#475569', Received: '#475569', 'Under Process': '#2563eb', 'Pending Info': '#6d28d9', Transferred: '#075985',
  Escalated: '#9a3412', Disposed: '#166534',
}

export function BureauBadge({ code, className }: { code: string; className?: string }) {
  const c = BUREAU_COLORS[code] || '#475569'
  return (
    <span className={cx('inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-bold tracking-wide', className)}
      style={{ background: c + '16', color: c, border: `1px solid ${c}33` }}>{code}</span>
  )
}

export function StatusChip({ status }: { status: string }) {
  const c = STATUS_COLORS[status] || '#64748b'
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
      style={{ background: c + '18', color: c }}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />{status}
    </span>
  )
}

export function SlaChip({ sla }: { sla: any }) {
  if (!sla) return null
  if (sla.state === 'CLOSED') return <span className="text-xs text-slate-600">Closed</span>
  const over = sla.remaining_days < 0
  const tone = sla.state === 'BREACHED' ? 'bg-red-50 text-red-700 ring-red-200'
    : sla.state === 'NEARING' ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-slate-50 text-slate-600 ring-slate-200'
  const w = Math.max(0, Math.min(100, Number(sla.elapsed_pct) || 0))
  const bar = sla.state === 'BREACHED' ? '#dc2626' : sla.state === 'NEARING' ? '#d97706' : '#64748b'
  const description = sla.state === 'BREACHED' ? 'SLA breached' : sla.state === 'NEARING' ? 'SLA nearing deadline' : 'SLA within timeline'
  return (
    <div role="img" aria-label={`${description}, ${Math.abs(sla.remaining_days)} days ${over ? 'overdue' : 'remaining'}`}
      className={cx('inline-flex flex-col gap-1 rounded-md px-2 py-1 ring-1 ring-inset min-w-[84px]', tone)}>
      <span className="text-[11px] font-semibold num leading-none" aria-hidden="true">
        {over ? `${Math.abs(sla.remaining_days)}d overdue` : `${sla.remaining_days}d left`}
      </span>
      <span aria-hidden="true" className="h-1 w-full rounded-full bg-black/10 overflow-hidden">
        <span className="block h-full rounded-full" style={{ width: w + '%', background: bar }} />
      </span>
    </div>
  )
}

export function BandBadge({ band }: { band: string }) {
  const high = band === 'HIGH'
  return (
    <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wide',
      high ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>
      {high ? 'HIGH OVERLAP' : 'POSSIBLE OVERLAP'}
    </span>
  )
}

export function ScoreRing({ score, band, size = 64 }: { score: number; band: string; size?: number }) {
  const r = size / 2 - 5, c = 2 * Math.PI * r
  const color = band === 'HIGH' ? '#dc2626' : '#d97706'

  return (
    <div
      className="relative shrink-0"
      role="img"
      aria-label={`${Math.round(score)} percent match, ${band.toLowerCase()} overlap`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth="6" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
        />
      </svg>

      <div aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={cx(
            'font-bold num leading-none',
            score >= 100 ? 'text-[13px]' : 'text-base'
          )}
          style={{ color }}
        >
          {Math.round(score)}%
        </span>
        <span className="mt-1 text-[9px] uppercase tracking-wider text-slate-600">
          match
        </span>
      </div>
    </div>
  )
}
export function Card({ title, right, children, className, pad = true }:
  { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx('rounded-xl bg-white shadow-sm ring-1 ring-slate-200/70', className)}>
      {(title || right) && (
        <header className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5 pb-1 sm:flex-nowrap sm:gap-0">
          <h3 className="min-w-0 text-sm font-semibold text-slate-800">{title}</h3>{right}
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  )
}

export function Drawer({ open, onClose, title, children, width = 560 }:
  { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number }) {
  const titleId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    if (!open) return

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(selector) || [])
      .filter(el => el.getClientRects().length > 0 && !el.closest('[inert], [aria-hidden="true"]'))

    const frame = requestAnimationFrame(() => closeButtonRef.current?.focus())

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const elements = focusable()
      if (!elements.length) {
        event.preventDefault()
        dialogRef.current?.focus()
        return
      }
      const first = elements[0], last = elements[elements.length - 1]
      const focused = document.activeElement
      if (!dialogRef.current?.contains(focused)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && (focused === first || focused === dialogRef.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault()
        first.focus()
      }
    }
    function handleFocus(event: FocusEvent) {
      if (dialogRef.current && event.target instanceof Node && !dialogRef.current.contains(event.target)) {
        closeButtonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('focusin', handleFocus)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('focusin', handleFocus)
      document.body.style.overflow = previousOverflow
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" aria-hidden="true" onClick={onClose} />
      <aside ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="relative h-full bg-white shadow-2xl toast-in flex flex-col" style={{ width: `min(${width}px, 100vw)` }}>
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div id={titleId} className="min-w-0">{title}</div>
          <button ref={closeButtonRef} type="button" aria-label="Close dialog" onClick={onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="p-10 text-center text-sm text-slate-700" role="status">{label}</div>
}
export function ErrorBox({ msg }: { msg: string }) {
  return <div className="m-4 rounded-lg bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-200">{msg}</div>
}

export const fmtDate = (s?: string) => {
  if (!s) return '—'
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}
export const fmtTs = (s?: string) => {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
}
export const ago = (s?: string) => {
  if (!s) return ''
  const m = Math.max(0, Math.round((Date.now() - new Date(s).getTime()) / 60000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  if (m < 1440) return `${Math.round(m / 60)}h ago`
  return `${Math.round(m / 1440)}d ago`
}

export const RISK_COLORS: Record<string, string> = { HIGH: '#dc2626', MEDIUM: '#d97706', LOW: '#16a34a' }

export function RiskBadge({ score, band, size = 'sm', title }: { score: number; band: string; size?: 'sm' | 'lg'; title?: string }) {
  const c = RISK_COLORS[band] || '#64748b'
  const big = size === 'lg'
  return (
    <span title={title} aria-label={`${score}, ${band.toLowerCase()} risk`}
      className={cx('inline-flex items-center gap-1.5 rounded-full font-bold num', big ? 'px-3.5 py-1.5 text-base' : 'px-2 py-0.5 text-xs')}
      style={{ background: c + '18', color: c, border: `1px solid ${c}40` }}>
      <span aria-hidden="true" className={cx('rounded-full', big ? 'h-2.5 w-2.5' : 'h-1.5 w-1.5')} style={{ background: c }} />
      {score}<span className="font-semibold opacity-70">{big ? ` · ${band} RISK` : ''}</span>
    </span>
  )
}

/** Live SLA countdown to the end of the due date, using the server's (demo) clock. */
export function Countdown({ dueDate, serverNow, closed }: { dueDate: string; serverNow: string; closed?: boolean }) {
  const [tick, setTick] = useState(0)
  const drift = useRef(new Date(serverNow).getTime() - Date.now())
  useEffect(() => { drift.current = new Date(serverNow).getTime() - Date.now() }, [serverNow])
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t) }, [])
  if (closed) return <span className="text-sm text-slate-600">Closed</span>
  const diff = new Date(dueDate + 'T23:59:59').getTime() - (Date.now() + drift.current)
  const over = diff < 0
  const a = Math.abs(diff)
  const d = Math.floor(a / 86400000), h = Math.floor((a % 86400000) / 3600000)
  const m = Math.floor((a % 3600000) / 60000), s = Math.floor((a % 60000) / 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    <div aria-live="off" className={cx('num font-mono text-lg font-bold tracking-tight', over ? 'text-red-600' : 'text-slate-800')} data-tick={tick}>
      {over ? '−' : ''}{d}d {p(h)}:{p(m)}:{p(s)}
      <span className="ml-2 font-sans text-[11px] font-semibold uppercase tracking-wider opacity-70">{over ? 'overdue' : 'remaining'}</span>
    </div>
  )
}
