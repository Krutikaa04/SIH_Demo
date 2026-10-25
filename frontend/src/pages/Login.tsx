import { FormEvent, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, Eye, EyeOff, FlaskConical, GitMerge, Info, Lock, ShieldCheck } from 'lucide-react'
import { signIn, useAuth } from '../api'
import { BUREAU_COLORS, Chakra, Logo, cx } from '../ui'

const POINTS = [
  ['See who else is handling an institution', 'Before you act, not after.'],
  ['Agree who leads, then record it', 'One decision, written into every case.'],
  ['Every step is on the record', 'Changes cannot be quietly rewritten.'],
]
const monogram = (role: string) => ({ SENIOR: 'SM', REGIONAL: 'RO' } as any)[role] || role.slice(0, 2)

export function PasswordField({ id, label, value, onChange, autoComplete, hint, autoFocus, onKeyDown }:
  { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string; hint?: string; autoFocus?: boolean; onKeyDown?: (e: any) => void }) {
  const [show, setShow] = useState(false)
  const [caps, setCaps] = useState(false)
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-[13px] font-semibold text-slate-700"><span>{label}</span>
        {caps && <span className="flex items-center gap-1 text-[11.5px] font-semibold text-orange-600"><AlertTriangle size={12} /> Caps Lock is on</span>}</span>
      <span className="relative block">
        <input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} autoFocus={autoFocus}
          onKeyUp={(e) => setCaps(e.getModifierState?.('CapsLock') || false)} onKeyDown={onKeyDown} className="field !py-3 !pr-11" />
        <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>
      </span>
      {hint && <span className="mt-1 block text-[12px] text-slate-500">{hint}</span>}
    </label>
  )
}

/** A static picture of the product's one big idea, so the sign-in page already shows what the app is for. */
function AlertPreview() {
  return (
    <div aria-hidden className="glass relative mt-10 max-w-md rounded-2xl p-4 shadow-[0_30px_70px_-30px_rgb(0_0_0/.8)]" style={{ transform: 'rotate(-1.5deg)' }}>
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-500/20 text-[#ff9aa4] pulse-red"><GitMerge size={19} /></span>
        <div className="min-w-0">
          <div className="font-display text-[15px] font-bold leading-snug">Potential Overlapping Cases — Coordination Required</div>
          <div className="mt-0.5 text-[12px] text-white/60">Same institution · 3 Bureaus · caught on arrival</div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        {['RB', 'PGRC', 'AB'].map((b) => (
          <span key={b} className="flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[11px] font-bold" style={{ background: `${BUREAU_COLORS[b]}33`, color: '#fff', boxShadow: `inset 0 0 0 1px ${BUREAU_COLORS[b]}88` }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: BUREAU_COLORS[b] }} />{b}</span>))}
        <span className="ml-auto flex items-center gap-1 text-[12px] font-semibold text-[#ffb066]">88% match <ArrowRight size={13} /></span>
      </div>
    </div>
  )
}

export default function Login() {
  const { config, notice } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<{ message: string; locked?: boolean } | null>(null)
  const user = useRef<HTMLInputElement>(null)
  useEffect(() => { user.current?.focus() }, [])

  async function go(u: string, p: string, tag = 'form') {
    setBusy(tag); setError(null)
    try { await signIn(u.trim(), p) }
    catch (e: any) {
      setError({ message: e.status === 0 || e.message === 'Failed to fetch' ? 'Cannot reach the server. Check that the app is running.' : e.message, locked: e.status === 423 })
      setPassword('')
    } finally { setBusy('') }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); if (username.trim() && password) go(username, password) }

  return (
    <div data-theme="dark" className="relative min-h-screen overflow-hidden bg-night-950 text-white">
      {/* aurora */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="drift-a absolute -left-40 -top-40 h-[42rem] w-[42rem] rounded-full opacity-60 blur-[110px]" style={{ background: 'radial-gradient(circle, #3d5bff, transparent 65%)' }} />
        <div className="drift-b absolute -bottom-52 right-[-10rem] h-[40rem] w-[40rem] rounded-full opacity-45 blur-[120px]" style={{ background: 'radial-gradient(circle, #ff8a1f, transparent 65%)' }} />
        <div className="drift-a absolute left-[38%] top-[30%] h-[26rem] w-[26rem] rounded-full opacity-30 blur-[100px]" style={{ background: 'radial-gradient(circle, #10b981, transparent 65%)' }} />
        <div className="absolute inset-0 opacity-60" style={{ background: 'radial-gradient(rgb(255 255 255 / .07) 1px, transparent 1.2px) 0 0 / 26px 26px', WebkitMaskImage: 'radial-gradient(ellipse at 40% 40%, #000, transparent 75%)', maskImage: 'radial-gradient(ellipse at 40% 40%, #000, transparent 75%)' }} />
        <Chakra className="spin-slow absolute -right-44 top-1/2 h-[46rem] w-[46rem] -translate-y-1/2 text-white/[.05]" />
      </div>

      <div className="relative mx-auto grid min-h-screen max-w-[1280px] items-center gap-10 px-6 py-10 lg:grid-cols-[1.1fr_1fr] lg:px-12">
        {/* ---------- story ---------- */}
        <section className="hidden lg:block">
          <div className="rise flex items-center gap-3">
            <Logo size={46} />
            <div className="leading-tight"><div className="text-[10.5px] font-bold uppercase tracking-[.22em] text-white/50">AICTE · ICMD</div>
              <div className="font-display text-[1.5rem] font-bold">Complaint Desk</div></div>
          </div>
          <h1 className="rise rise-1 font-display mt-12 text-[4rem] font-extrabold leading-[1] tracking-tight">One window for <span className="text-gradient">every complaint.</span></h1>
          <p className="rise rise-2 mt-6 max-w-xl text-[17.5px] leading-relaxed text-white/70">The Bureaus, Cells and Regional Offices of AICTE, working from the same file, so no institution is contacted twice and no one works against another.</p>
          <ul className="rise rise-3 mt-8 space-y-4">
            {POINTS.map(([t, d]) => (
              <li key={t} className="flex gap-3.5">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-saffron shadow-[0_0_12px_rgb(255_138_31/.9)]" />
                <span><span className="block text-[15.5px] font-semibold">{t}</span><span className="text-[14px] text-white/55">{d}</span></span>
              </li>))}
          </ul>
          <div className="rise rise-4"><AlertPreview /></div>
        </section>

        {/* ---------- form ---------- */}
        <main className="rise rise-2 mx-auto w-full max-w-[460px]">
          <div className="mb-7 flex items-center gap-3 lg:hidden"><Logo size={40} /><span className="font-display text-xl font-bold">Complaint Desk</span></div>
          <div className="relative rounded-[1.75rem] p-px" style={{ background: 'linear-gradient(160deg, rgb(255 255 255 / .35), rgb(255 255 255 / .06) 40%, rgb(255 138 31 / .35))' }}>
            <div className="rounded-[1.7rem] bg-[#0b1230]/90 p-7 shadow-[0_40px_90px_-30px_rgb(0_0_0/.9)] backdrop-blur-2xl sm:p-9">
              <h2 className="font-display text-[2.125rem] font-bold leading-tight">Sign in</h2>
              <p className="mt-1.5 text-[15px] text-white/60">Use the account your administrator gave you.</p>

              {notice && !error && <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-[13.5px] text-[#ffe29a]" role="status"><Info size={16} className="mt-0.5 shrink-0" />{notice}</div>}
              {error && (
                <div className={cx('mt-5 flex items-start gap-2.5 rounded-xl border p-3 text-[13.5px]', error.locked ? 'border-amber-400/30 bg-amber-400/10 text-[#ffe29a]' : 'border-red-400/30 bg-red-500/10 text-[#ffc4ca]')} role="alert">
                  {error.locked ? <Lock size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}{error.message}</div>)}

              <form onSubmit={submit} className="mt-6 space-y-5" noValidate>
                <label htmlFor="username" className="block"><span className="mb-1.5 block text-[13px] font-semibold text-slate-700">Username</span>
                  <input id="username" ref={user} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} className="field !py-3" /></label>
                <PasswordField id="password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
                <button type="submit" disabled={!username.trim() || !password || !!busy} className="btn btn-accent w-full !py-3.5 !text-base">
                  <ShieldCheck size={18} /> {busy === 'form' ? 'Signing in…' : 'Sign in'}</button>
              </form>
              <p className="mt-4 text-[12px] leading-relaxed text-white/45">After five wrong passwords the account is locked for 15 minutes. You are signed out automatically after a period of inactivity.</p>

              {config?.demo_mode && config.demo_accounts && (
                <section className="mt-7 rounded-2xl border border-dashed border-white/15 bg-white/[.03] p-4" aria-label="Demo accounts">
                  <div className="flex items-center justify-between gap-2"><h3 className="eyebrow !text-white/60">Demo accounts</h3><span className="flex items-center gap-1 text-[11px] text-white/40"><FlaskConical size={11} /> prototype only</span></div>
                  <p className="mt-1 text-[12px] text-white/50">Choose a role to sign in as that person. They share one demo password, so this list is switched off outside demo mode.</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {config.demo_accounts.filter((a) => a.role !== 'REGIONAL' || a.region === 'Western').map((a) => (
                      <button key={a.username} type="button" disabled={!!busy} onClick={() => go(a.username, config.demo_password || '', a.username)}
                        className="group flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[.05] p-2.5 text-left transition hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/[.09] disabled:opacity-50">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg font-mono text-[11px] font-bold text-white shadow-lg" style={{ background: `linear-gradient(135deg, ${BUREAU_COLORS[a.role]}, color-mix(in srgb, ${BUREAU_COLORS[a.role]} 50%, #050918))` }}>{monogram(a.role)}</span>
                        <span className="min-w-0"><span className="block truncate text-[12.5px] font-semibold text-white">{a.label}</span><span className="block truncate text-[11px] text-white/50">{busy === a.username ? 'Signing in…' : a.name}</span></span>
                      </button>))}
                  </div>
                </section>)}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
