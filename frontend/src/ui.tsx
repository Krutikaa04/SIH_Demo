import { ReactNode, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowUpRight, X } from 'lucide-react'

export const cx = (...a: any[]) => a.filter(Boolean).join(' ')

export const BUREAU_COLORS: Record<string, string> = {
  RB: '#34508f', PGRC: '#70509e', AB: '#1f7a6b', LC: '#a8641a', VIG: '#b03a2e', SENIOR: '#1b2547', REGIONAL: '#5a5951',
}
export const BUREAU_NAMES: Record<string, string> = {
  RB: 'Regulation Bureau', PGRC: 'Public Grievance Cell', AB: 'Approval Bureau', LC: 'Legal Cell', VIG: 'Vigilance Cell',
  SENIOR: 'Senior Management', REGIONAL: 'Regional Office',
}
export const STATUS_COLORS: Record<string, string> = {
  'Received / Pending Info': '#8a8575', Received: '#8a8575', 'Under Process': '#364f8f', 'Pending Info': '#70509e',
  Transferred: '#247a88', Escalated: '#c2620f', Disposed: '#236948',
}

/** A Bureau shown as a small ink tab: monogram in mono, tinted in the Bureau's own colour. */
export function BureauBadge({ code, className, full }: { code: string; className?: string; full?: boolean }) {
  const c = BUREAU_COLORS[code] || '#5a5951'
  return (
    <span title={BUREAU_NAMES[code] || code}
      className={cx('inline-flex items-center gap-1 rounded-[4px] px-1.5 py-px font-mono text-[11px] font-semibold tracking-tight', className)}
      style={{ background: c + '14', color: c, boxShadow: `inset 2px 0 0 ${c}` }}>
      <span className="pl-0.5">{code}</span>{full && <span className="font-sans font-medium opacity-80">{BUREAU_NAMES[code]}</span>}
    </span>
  )
}

export function StatusChip({ status }: { status: string }) {
  const c = STATUS_COLORS[status] || '#5a5951'
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-[4px] border px-1.5 py-px text-[11.5px] font-semibold"
      style={{ background: c + '12', color: c, borderColor: c + '38' }}>
      {status}
    </span>
  )
}

/** "12 days overdue" / "5 days left", as words first and a thin gauge second. */
export function dueText(sla: any) {
  if (!sla) return ''
  if (sla.state === 'CLOSED') return 'Closed'
  const n = Math.abs(sla.remaining_days)
  const days = `${n} day${n === 1 ? '' : 's'}`
  if (sla.remaining_days < 0) return `${days} overdue`
  if (sla.remaining_days === 0) return 'Due today'
  return `${days} left`
}

export function SlaChip({ sla }: { sla: any }) {
  if (!sla) return null
  if (sla.state === 'CLOSED') return <span className="text-xs text-slate-400">Closed</span>
  const breached = sla.state === 'BREACHED'
  const nearing = sla.state === 'NEARING'
  const color = breached ? '#b93b1f' : nearing ? '#b76011' : '#5a5951'
  const w = Math.min(100, sla.elapsed_pct)
  return (
    <div className="inline-flex min-w-[88px] flex-col gap-1" title={`${sla.days}-day prescribed timeline, ${Math.round(sla.elapsed_pct)}% used`}>
      <span className={cx('text-[12px] leading-none num', breached ? 'font-bold' : 'font-semibold')} style={{ color }}>{dueText(sla)}</span>
      <span className="h-[3px] w-full overflow-hidden rounded-full bg-slate-200">
        <span className="block h-full rounded-full" style={{ width: w + '%', background: color }} />
      </span>
    </div>
  )
}

export function BandBadge({ band }: { band: string }) {
  const high = band === 'HIGH'
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-px text-[11px] font-bold uppercase tracking-wider',
      high ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-700')}>
      {high ? 'Strong overlap' : 'Possible overlap'}
    </span>
  )
}

export function ScoreRing({ score, band, size = 64 }: { score: number; band: string; size?: number }) {
  const r = size / 2 - 5, c = 2 * Math.PI * r
  const color = band === 'HIGH' ? '#b93b1f' : '#b76011'
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5dfd0" strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-[1.05rem] font-semibold num leading-none" style={{ color, fontSize: size * 0.25 }}>{Math.round(score)}%</span>
        {size >= 60 && <span className="mt-0.5 text-[8.5px] font-bold uppercase tracking-[.12em] text-slate-400">match</span>}
      </div>
    </div>
  )
}

/** The basic surface: a sheet of paper with a hairline edge. */
export function Card({ title, subtitle, right, children, className, pad = true }:
  { title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx('rounded-xl border border-line bg-sheet shadow-sm', className)}>
      {(title || subtitle || right) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-1">
          <div className="min-w-0">
            {title && <h3 className="font-display text-[1.0625rem] font-semibold leading-snug text-slate-900">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-[13px] text-slate-500">{subtitle}</p>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </header>
      )}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </section>
  )
}

export function PageHeader({ eyebrow, title, subtitle, actions, back }:
  { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <header className="rise mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-3xl">
        {back && <Link to={back.to} className="mb-2 inline-flex items-center gap-1 text-[13px] font-medium text-slate-500 hover:text-slate-900">← {back.label}</Link>}
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="font-display text-[1.875rem] font-semibold leading-[1.1] text-slate-900 md:text-[2.125rem]">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/** A big serif figure with a label: the unit of "how am I doing". */
export function Stat({ label, value, tone = 'ink', to, hint, small }:
  { label: string; value: ReactNode; tone?: 'ink' | 'red' | 'amber' | 'green' | 'plum' | 'blue'; to?: string; hint?: ReactNode; small?: boolean }) {
  const color = { ink: '#1b2130', red: '#b93b1f', amber: '#b76011', green: '#236948', plum: '#5b4085', blue: '#364f8f' }[tone]
  const body = (
    <>
      <div className="eyebrow">{label}</div>
      <div className={cx('font-display num mt-1 font-semibold leading-none', small ? 'text-[1.75rem]' : 'text-[2.5rem]')} style={{ color }}>{value}</div>
      {hint && <div className="mt-1.5 text-[12.5px] leading-snug text-slate-500">{hint}</div>}
    </>
  )
  const base = 'relative block rounded-xl border border-line bg-sheet p-4 text-left shadow-sm'
  return to ? (
    <Link to={to} className={cx(base, 'group transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md')}>
      {!small && <ArrowUpRight size={15} className="absolute right-3 top-3 text-slate-300 transition group-hover:text-slate-600" />}
      {body}
    </Link>
  ) : <div className={base}>{body}</div>
}

export function Segmented({ options, value, onChange, label }:
  { options: readonly (readonly [string, ReactNode])[]; value: string; onChange: (v: any) => void; label?: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-lg border border-line bg-slate-100 p-0.5 text-sm">
      {options.map(([k, l]) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          className={cx('rounded-md px-3.5 py-1.5 font-semibold transition', value === k ? 'bg-sheet text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>{l}</button>))}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, children, action }: { icon?: any; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {Icon && <div className="mb-1 grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><Icon size={22} /></div>}
      <div className="font-display text-lg font-semibold text-slate-800">{title}</div>
      {children && <p className="max-w-md text-sm leading-relaxed text-slate-500">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** Brand mark: two overlapping case-file tabs, the product's one idea. */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="AICTE ICMD">
      <rect x="1" y="1" width="38" height="38" rx="9" fill="#1b2547" />
      <path d="M9 13.5a2.5 2.5 0 0 1 2.5-2.5h6.2l2.3 2.6H27a2.5 2.5 0 0 1 2.5 2.5V25a2.5 2.5 0 0 1-2.5 2.5H11.5A2.5 2.5 0 0 1 9 25z" fill="none" stroke="#f4f0e6" strokeWidth="1.8" />
      <path d="M17 19.5a2.5 2.5 0 0 1 2.5-2.5H25l2 2.3h4.5A2.5 2.5 0 0 1 34 21.8V29a2.5 2.5 0 0 1-2.5 2.5H19.5A2.5 2.5 0 0 1 17 29z" fill="#d4601c" stroke="#1b2547" strokeWidth="1.8" />
    </svg>
  )
}

export function Drawer({ open, onClose, title, children, width = 560 }:
  { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="toast-in relative flex h-full flex-col border-l border-line bg-sheet shadow-xl" style={{ width: `min(${width}px, 100vw)` }}>
        <header className="flex items-start justify-between gap-3 border-b border-line px-6 py-5">
          <div className="min-w-0">{title}</div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><X size={18} /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </aside>
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="space-y-4 p-2" role="status" aria-label={label}>
      <div className="h-9 w-72 animate-pulse rounded-md bg-slate-200/70" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded bg-slate-200/50" />
      <div className="grid gap-4 pt-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-200/50" />)}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-slate-200/40" />
    </div>
  )
}
export function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="m-2 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <div><b className="font-semibold">Something went wrong.</b> <span className="opacity-90">{msg}</span></div>
    </div>
  )
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
export const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export const RISK_COLORS: Record<string, string> = { HIGH: '#b93b1f', MEDIUM: '#b76011', LOW: '#236948' }

export function RiskBadge({ score, band, size = 'sm', title }: { score: number; band: string; size?: 'sm' | 'lg'; title?: string }) {
  const c = RISK_COLORS[band] || '#5a5951'
  const big = size === 'lg'
  return (
    <span title={title} className={cx('inline-flex items-center gap-1.5 rounded-[5px] font-bold num', big ? 'px-3 py-1.5 text-base' : 'px-1.5 py-0.5 text-xs')}
      style={{ background: c + '14', color: c, border: `1px solid ${c}38` }}>
      <span className={cx('rounded-full', big ? 'h-2.5 w-2.5' : 'h-1.5 w-1.5')} style={{ background: c }} />
      {score}<span className="font-semibold opacity-75">{big ? ` · ${band === 'HIGH' ? 'High' : band === 'MEDIUM' ? 'Medium' : 'Low'} risk` : ''}</span>
    </span>
  )
}

/** Live countdown to the end of the due date, using the server's (demo) clock. */
export function Countdown({ dueDate, serverNow, closed }: { dueDate: string; serverNow: string; closed?: boolean }) {
  const [tick, setTick] = useState(0)
  const drift = useRef(new Date(serverNow).getTime() - Date.now())
  useEffect(() => { drift.current = new Date(serverNow).getTime() - Date.now() }, [serverNow])
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t) }, [])
  if (closed) return <span className="text-sm text-slate-400">Closed</span>
  const diff = new Date(dueDate + 'T23:59:59').getTime() - (Date.now() + drift.current)
  const over = diff < 0
  const a = Math.abs(diff)
  const d = Math.floor(a / 86400000), h = Math.floor((a % 86400000) / 3600000)
  const m = Math.floor((a % 3600000) / 60000), s = Math.floor((a % 60000) / 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    <div className={cx('font-mono text-[1.05rem] font-semibold tracking-tight num', over ? 'text-red-600' : 'text-slate-800')} data-tick={tick}>
      {over ? '−' : ''}{d}d {p(h)}:{p(m)}:{p(s)}
    </div>
  )
}
