import { ReactNode, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowUpRight, X } from 'lucide-react'

export const cx = (...a: any[]) => a.filter(Boolean).join(' ')

/** Colour helpers that adapt to the active theme: tints are alpha mixes, text colours borrow from --color-ink. */
export const tint = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`
export const inkOf = (c: string, pct = 72) => `color-mix(in srgb, ${c} ${pct}%, var(--color-ink))`

export const BUREAU_COLORS: Record<string, string> = {
  RB: '#3b5efa', PGRC: '#b14df0', AB: '#10a59b', LC: '#f59e0b', VIG: '#e5484d', SENIOR: '#3347b5', REGIONAL: '#64708f',
}
export const BUREAU_NAMES: Record<string, string> = {
  RB: 'Regulation Bureau', PGRC: 'Public Grievance Cell', AB: 'Approval Bureau', LC: 'Legal Cell', VIG: 'Vigilance Cell',
  SENIOR: 'Senior Management', REGIONAL: 'Regional Office',
}
export const STATUS_COLORS: Record<string, string> = {
  'Received / Pending Info': '#8792b8', Received: '#8792b8', 'Under Process': '#3b5efa', 'Pending Info': '#8445f5',
  Transferred: '#06b6d4', Escalated: '#ff8a1f', Disposed: '#10b981',
}

/** A Bureau as a small monogram tag in its own colour. */
export function BureauBadge({ code, className, full }: { code: string; className?: string; full?: boolean }) {
  const c = BUREAU_COLORS[code] || '#64708f'
  return (
    <span title={BUREAU_NAMES[code] || code}
      className={cx('inline-flex items-center gap-1.5 rounded-md px-1.5 py-px font-mono text-[11px] font-bold tracking-tight', className)}
      style={{ background: tint(c, 15), color: inkOf(c), boxShadow: `inset 0 0 0 1px ${tint(c, 32)}` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />{code}
      {full && <span className="font-sans font-medium opacity-80">{BUREAU_NAMES[code]}</span>}
    </span>
  )
}

export function StatusChip({ status }: { status: string }) {
  const c = STATUS_COLORS[status] || '#8792b8'
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold"
      style={{ background: tint(c, 14), color: inkOf(c, 78), boxShadow: `inset 0 0 0 1px ${tint(c, 28)}` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c, boxShadow: `0 0 7px ${c}` }} />{status}
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
  const color = breached ? '#ec4658' : nearing ? '#ff8a1f' : '#8792b8'
  const w = Math.min(100, sla.elapsed_pct)
  return (
    <div className="inline-flex min-w-[92px] flex-col gap-1.5" title={`${sla.days}-day prescribed timeline, ${Math.round(sla.elapsed_pct)}% used`}>
      <span className={cx('text-[12px] leading-none num', breached ? 'font-bold' : 'font-semibold')} style={{ color: inkOf(color, 85) }}>{dueText(sla)}</span>
      <span className="h-1 w-full overflow-hidden rounded-full bg-slate-200/80">
        <span className="block h-full rounded-full" style={{ width: w + '%', background: `linear-gradient(90deg, ${tint(color, 60)}, ${color})`, boxShadow: breached ? `0 0 8px ${color}` : undefined }} />
      </span>
    </div>
  )
}

export function BandBadge({ band }: { band: string }) {
  const high = band === 'HIGH'
  const c = high ? '#ec4658' : '#ff8a1f'
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider"
      style={{ background: tint(c, 14), color: inkOf(c, 85), boxShadow: `inset 0 0 0 1px ${tint(c, 32)}` }}>
      <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: c, boxShadow: `0 0 7px ${c}` }} />{high ? 'Strong overlap' : 'Possible overlap'}
    </span>
  )
}

export function ScoreRing({ score, band, size = 64 }: { score: number; band: string; size?: number }) {
  const id = useId().replace(/:/g, '')
  const r = size / 2 - 6, c = 2 * Math.PI * r
  const [from, to] = band === 'HIGH' ? ['#ff8a1f', '#ec4658'] : ['#fcd34d', '#ff8a1f']
  return (
    <div className="relative shrink-0" style={{ width: size, height: size, filter: `drop-shadow(0 4px 10px ${tint(to, 35)})` }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={from} /><stop offset="1" stopColor={to} /></linearGradient></defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-slate-200)" strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${id})`} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1)' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display num font-bold leading-none" style={{ color: inkOf(to, 90), fontSize: size * 0.27 }}>{Math.round(score)}%</span>
        {size >= 60 && <span className="mt-0.5 text-[8.5px] font-bold uppercase tracking-[.14em] text-slate-400">match</span>}
      </div>
    </div>
  )
}

/** The basic surface. */
export function Card({ title, subtitle, right, children, className, pad = true }:
  { title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx('rounded-2xl border border-line bg-sheet shadow-sm', className)}>
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
    <header className="rise mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-3xl">
        {back && <Link to={back.to} className="mb-2.5 inline-flex items-center gap-1 text-[13px] font-semibold text-slate-500 transition hover:text-navy-2">← {back.label}</Link>}
        {eyebrow && <div className="eyebrow mb-2 flex items-center gap-2 !text-navy-2"><span className="h-px w-5 bg-gradient-to-r from-saffron to-transparent" />{eyebrow}</div>}
        <h1 className="font-display text-[1.875rem] font-bold leading-[1.08] text-slate-900 md:text-[2.375rem]">{title}</h1>
        {subtitle && <p className="mt-2.5 max-w-2xl text-[15px] leading-relaxed text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

// ---- numbers that move -------------------------------------------------------------------------

/** Counts up to a number (or a "40%"-style string) once, unless the person prefers reduced motion. */
export function CountUp({ value, ms = 900 }: { value: number | string; ms?: number }) {
  const m = typeof value === 'number' ? [String(value), String(value), ''] : String(value).match(/^(-?\d+(?:\.\d+)?)(.*)$/)
  const target = m ? parseFloat(m[1]) : NaN
  const suffix = m ? m[2] : ''
  const decimals = m && m[1].includes('.') ? m[1].split('.')[1].length : 0
  const [n, setN] = useState(Number.isNaN(target) ? 0 : 0)
  useEffect(() => {
    if (Number.isNaN(target)) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setN(target); return }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      setN(target * (1 - Math.pow(1 - k, 4)))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  if (Number.isNaN(target)) return <>{value}</>
  return <>{n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</>
}

/** A small trend line that draws itself. */
export function Sparkline({ data, color = '#3b5efa', width = 120, height = 38, className }:
  { data: number[]; color?: string; width?: number; height?: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  if (data.length < 2) return null
  const max = Math.max(...data), min = Math.min(...data)
  const pts = data.map((v, i) => [(i / (data.length - 1)) * width, height - 4 - ((v - min) / (max - min || 1)) * (height - 10)])
  const d = pts.map(([x, y], i) => (i ? `L${x.toFixed(1)} ${y.toFixed(1)}` : `M${x.toFixed(1)} ${y.toFixed(1)}`)).join(' ')
  const last = pts[pts.length - 1]
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".35" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${d} L${width} ${height} L0 ${height} Z`} fill={`url(#${id})`} style={{ animation: 'fade 1s .5s both' }} />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1}
        style={{ ['--len' as any]: 1, animation: 'draw 1.3s cubic-bezier(.2,.8,.2,1) both' }} />
      <circle cx={last[0]} cy={last[1]} r="3" fill={color} style={{ animation: 'fade .4s 1.2s both' }} />
    </svg>
  )
}

/** A circular progress gauge with a label in the middle. */
export function Gauge({ value, size = 132, label, sub, color = '#10b981', track = 'rgb(255 255 255 / .14)' }:
  { value: number; size?: number; label?: ReactNode; sub?: ReactNode; color?: string; track?: string }) {
  const id = useId().replace(/:/g, '')
  const r = size / 2 - 9, c = 2 * Math.PI * r
  const [v, setV] = useState(0)
  useEffect(() => { const t = setTimeout(() => setV(Math.max(0, Math.min(100, value))), 120); return () => clearTimeout(t) }, [value])
  return (
    <div className="relative shrink-0" style={{ width: size, height: size, filter: `drop-shadow(0 0 18px ${tint(color, 45)})` }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={color} /><stop offset="1" stopColor="#7df0c4" /></linearGradient></defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth="9" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${id})`} strokeWidth="9" strokeLinecap="round" strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)} style={{ transition: 'stroke-dashoffset 1.4s cubic-bezier(.2,.8,.2,1)' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-display num text-[2rem] font-bold leading-none">{label ?? <CountUp value={`${Math.round(value)}%`} />}</span>
        {sub && <span className="mt-1 max-w-[80%] text-[10.5px] font-semibold uppercase leading-tight tracking-wider opacity-70">{sub}</span>}
      </div>
    </div>
  )
}

const TONE: Record<string, string> = { ink: '#3b5efa', red: '#ec4658', amber: '#ff8a1f', green: '#10b981', plum: '#8445f5', blue: '#3b5efa' }

/** A headline figure: big number, a tinted corner glow, an optional icon and trend line. */
export function Stat({ label, value, tone = 'ink', to, hint, small, icon: Icon, spark }:
  { label: string; value: ReactNode; tone?: 'ink' | 'red' | 'amber' | 'green' | 'plum' | 'blue'; to?: string; hint?: ReactNode; small?: boolean; icon?: any; spark?: number[] }) {
  const c = TONE[tone]
  const colored = tone !== 'ink'
  const body = (
    <>
      <span className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ background: `radial-gradient(200px 110px at 100% 0%, ${tint(c, colored ? 16 : 9)}, transparent 70%)` }} />
      <span className="pointer-events-none absolute inset-x-6 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${tint(c, 70)}, transparent)` }} />
      <div className="relative flex items-start justify-between gap-2">
        <div className="eyebrow">{label}</div>
        {Icon && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: tint(c, 16), color: inkOf(c, 90), boxShadow: `inset 0 0 0 1px ${tint(c, 30)}` }}><Icon size={16} /></span>}
      </div>
      <div className={cx('font-display num relative mt-2 font-bold leading-none tracking-tight', small ? 'text-[1.75rem]' : 'text-[2.625rem]')} style={{ color: colored ? inkOf(c, 88) : 'var(--color-ink)' }}>
        {typeof value === 'number' || typeof value === 'string' ? <CountUp value={value} /> : value}
      </div>
      {hint && <div className="relative mt-2 text-[12.5px] leading-snug text-slate-500">{hint}</div>}
      {spark && <Sparkline data={spark} color={c} className="absolute bottom-3 right-4 opacity-90" width={92} height={32} />}
    </>
  )
  const base = 'relative block overflow-hidden rounded-2xl border border-line bg-sheet p-4 text-left shadow-sm'
  return to ? (
    <Link to={to} className={cx(base, 'group transition duration-200 hover:-translate-y-1 hover:shadow-lg')} style={{ ['--hover' as any]: c }}>
      {!small && !spark && <ArrowUpRight size={15} className="absolute bottom-3.5 right-3.5 text-slate-300 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-slate-600" />}
      {body}
    </Link>
  ) : <div className={base}>{body}</div>
}

export function Segmented({ options, value, onChange, label }:
  { options: readonly (readonly [string, ReactNode])[]; value: string; onChange: (v: any) => void; label?: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-xl border border-line bg-slate-100 p-1 text-sm">
      {options.map(([k, l]) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          className={cx('rounded-lg px-3.5 py-1.5 font-semibold transition', value === k ? 'bg-sheet text-slate-900 shadow-sm ring-1 ring-line' : 'text-slate-500 hover:text-slate-800')}>{l}</button>))}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, children, action }: { icon?: any; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      {Icon && (
        <div className="relative mb-2 grid h-16 w-16 place-items-center">
          <span className="absolute inset-0 rounded-full border border-dashed border-slate-300 spin-slow" />
          <span className="absolute inset-2 rounded-full bg-gradient-to-br from-blue-100 to-orange-100" />
          <Icon size={24} className="relative text-navy-2" />
        </div>)}
      <div className="font-display text-lg font-semibold text-slate-800">{title}</div>
      {children && <p className="max-w-md text-sm leading-relaxed text-slate-500">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** An Ashoka-style 24-spoke wheel: the national chakra as a quiet watermark. */
export function Chakra({ className, spokes = 24 }: { className?: string; spokes?: number }) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden fill="none" stroke="currentColor">
      <circle cx="100" cy="100" r="92" strokeWidth="3" /><circle cx="100" cy="100" r="16" strokeWidth="3" />
      {Array.from({ length: spokes }, (_, i) => {
        const a = (i / spokes) * Math.PI * 2
        return <g key={i}><line x1={100 + Math.cos(a) * 18} y1={100 + Math.sin(a) * 18} x2={100 + Math.cos(a) * 88} y2={100 + Math.sin(a) * 88} strokeWidth="1.8" />
          <circle cx={100 + Math.cos(a + Math.PI / spokes) * 84} cy={100 + Math.sin(a + Math.PI / spokes) * 84} r="2.6" fill="currentColor" stroke="none" /></g>
      })}
    </svg>
  )
}

/** Brand mark: two overlapping case circles, with the overlap lit in saffron. That overlap is the product. */
export function Logo({ size = 34 }: { size?: number }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="AICTE ICMD">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4f6bff" /><stop offset="1" stopColor="#0a1442" /></linearGradient>
        <clipPath id={`${id}c`}><circle cx="16" cy="20" r="8.5" /></clipPath>
      </defs>
      <rect x="0.5" y="0.5" width="39" height="39" rx="10.5" fill={`url(#${id}g)`} stroke="rgb(255 255 255 / .22)" />
      <circle cx="24" cy="20" r="8.5" fill="#ff8a1f" clipPath={`url(#${id}c)`} />
      <circle cx="16" cy="20" r="8.5" fill="none" stroke="white" strokeWidth="2" />
      <circle cx="24" cy="20" r="8.5" fill="none" stroke="white" strokeWidth="2" />
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
      <div className="absolute inset-0 bg-night-950/60 backdrop-blur-sm" style={{ animation: 'fade .25s both' }} onClick={onClose} />
      <aside className="toast-in relative flex h-full flex-col border-l border-line bg-sheet shadow-xl" style={{ width: `min(${width}px, 100vw)` }}>
        <span className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-saffron via-navy to-transparent opacity-80" />
        <header className="flex items-start justify-between gap-3 border-b border-line bg-gradient-to-b from-slate-50 to-transparent px-6 py-5">
          <div className="min-w-0">{title}</div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"><X size={18} /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </aside>
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="space-y-4 p-2" role="status" aria-label={label}>
      <div className="skeleton h-10 w-72 rounded-lg" />
      <div className="skeleton h-4 w-96 max-w-full rounded" />
      <div className="grid gap-4 pt-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="skeleton h-32 rounded-2xl" />)}
      </div>
      <div className="skeleton h-64 rounded-2xl" />
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

export const RISK_COLORS: Record<string, string> = { HIGH: '#ec4658', MEDIUM: '#ff8a1f', LOW: '#10b981' }

export function RiskBadge({ score, band, size = 'sm', title }: { score: number; band: string; size?: 'sm' | 'lg'; title?: string }) {
  const c = RISK_COLORS[band] || '#8792b8'
  const big = size === 'lg'
  return (
    <span title={title} className={cx('inline-flex items-center gap-1.5 rounded-full font-bold num', big ? 'px-3.5 py-1.5 text-base' : 'px-2 py-0.5 text-xs')}
      style={{ background: tint(c, 14), color: inkOf(c, 85), boxShadow: `inset 0 0 0 1px ${tint(c, 32)}` }}>
      <span className={cx('rounded-full', big ? 'h-2.5 w-2.5' : 'h-1.5 w-1.5')} style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
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
    <div className={cx('font-mono text-[1.15rem] font-semibold tracking-tight num', over ? 'text-red-600' : 'text-slate-900')} data-tick={tick}
      style={over ? { textShadow: '0 0 18px rgb(236 70 88 / .45)' } : undefined}>
      {over ? '−' : ''}{d}d {p(h)}:{p(m)}:{p(s)}
    </div>
  )
}
