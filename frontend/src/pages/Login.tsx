import { FormEvent, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Eye, EyeOff, FlaskConical, Info, Lock, ShieldCheck } from 'lucide-react'
import { signIn, useAuth } from '../api'
import { BUREAU_COLORS, Logo, cx } from '../ui'

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
      <span className="mb-1.5 flex items-baseline justify-between text-[13.5px] font-semibold text-slate-800"><span>{label}</span>
        {caps && <span className="flex items-center gap-1 text-[11.5px] font-semibold text-orange-700"><AlertTriangle size={12} /> Caps Lock is on</span>}</span>
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
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* ---------- brand panel ---------- */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-navy p-12 text-paper lg:flex">
        <svg className="pointer-events-none absolute -right-24 -top-10 h-[34rem] w-[34rem] opacity-[.07]" viewBox="0 0 40 40" aria-hidden>
          <path d="M9 13.5a2.5 2.5 0 0 1 2.5-2.5h6.2l2.3 2.6H27a2.5 2.5 0 0 1 2.5 2.5V25a2.5 2.5 0 0 1-2.5 2.5H11.5A2.5 2.5 0 0 1 9 25z" fill="none" stroke="#f4f0e6" strokeWidth=".6" />
          <path d="M17 19.5a2.5 2.5 0 0 1 2.5-2.5H25l2 2.3h4.5A2.5 2.5 0 0 1 34 21.8V29a2.5 2.5 0 0 1-2.5 2.5H19.5A2.5 2.5 0 0 1 17 29z" fill="#d4601c" />
        </svg>
        <div className="relative flex items-center gap-3">
          <Logo size={42} />
          <div className="leading-tight"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-paper/60">AICTE · ICMD</div>
            <div className="font-display text-[1.375rem] font-semibold">Complaint Desk</div></div>
        </div>
        <div className="relative max-w-lg">
          <h1 className="font-display text-[3.25rem] font-semibold leading-[1.04]">One window for every complaint.</h1>
          <p className="mt-5 text-[17px] leading-relaxed text-paper/75">The Bureaus, Cells and Regional Offices of AICTE, working from the same file, so no institution is contacted twice and no one works against another.</p>
          <ul className="mt-9 space-y-4">
            {POINTS.map(([t, d]) => (
              <li key={t} className="flex gap-3.5">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-saffron" />
                <span><span className="block text-[15.5px] font-semibold">{t}</span><span className="text-[14px] text-paper/65">{d}</span></span>
              </li>))}
          </ul>
        </div>
        <div className="relative flex items-center gap-2 text-[12.5px] text-paper/55"><FlaskConical size={14} /> Prototype · synthetic data · works fully offline</div>
      </aside>

      {/* ---------- form ---------- */}
      <main className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[440px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden"><Logo size={38} /><span className="font-display text-xl font-semibold">Complaint Desk</span></div>
          <h2 className="font-display text-[2.125rem] font-semibold leading-tight text-slate-900">Sign in</h2>
          <p className="mt-1.5 text-[15px] text-slate-600">Use the account your administrator gave you.</p>

          {notice && !error && <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13.5px] text-amber-900" role="status"><Info size={16} className="mt-0.5 shrink-0" />{notice}</div>}
          {error && (
            <div className={cx('mt-5 flex items-start gap-2.5 rounded-lg border p-3 text-[13.5px]', error.locked ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-800')} role="alert">
              {error.locked ? <Lock size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}{error.message}</div>)}

          <form onSubmit={submit} className="mt-6 space-y-5" noValidate>
            <label htmlFor="username" className="block"><span className="mb-1.5 block text-[13.5px] font-semibold text-slate-800">Username</span>
              <input id="username" ref={user} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} className="field !py-3" /></label>
            <PasswordField id="password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
            <button type="submit" disabled={!username.trim() || !password || !!busy} className="btn btn-primary w-full !py-3.5 !text-base">
              <ShieldCheck size={17} /> {busy === 'form' ? 'Signing in…' : 'Sign in'}</button>
          </form>
          <p className="mt-4 text-[12.5px] leading-relaxed text-slate-500">After five wrong passwords the account is locked for 15 minutes. You are signed out automatically after a period of inactivity.</p>

          {config?.demo_mode && config.demo_accounts && (
            <section className="mt-9 rounded-xl border border-dashed border-slate-300 p-4" aria-label="Demo accounts">
              <div className="flex items-center justify-between gap-2"><h3 className="eyebrow">Demo accounts</h3><span className="text-[11px] text-slate-400">prototype only</span></div>
              <p className="mt-1 text-[12.5px] text-slate-500">Choose a role to sign in as that person. Every account has the same demo password, so this list is switched off outside demo mode.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {config.demo_accounts.filter((a) => a.role !== 'REGIONAL' || a.region === 'Western').map((a) => (
                  <button key={a.username} type="button" disabled={!!busy} onClick={() => go(a.username, config.demo_password || '', a.username)}
                    className="flex items-center gap-2.5 rounded-lg border border-line bg-sheet p-2.5 text-left transition hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-md disabled:opacity-50">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full font-mono text-[11px] font-semibold text-white" style={{ background: BUREAU_COLORS[a.role] }}>{monogram(a.role)}</span>
                    <span className="min-w-0"><span className="block truncate text-[13px] font-semibold text-slate-900">{a.label}</span><span className="block truncate text-[11.5px] text-slate-500">{busy === a.username ? 'Signing in…' : a.name}</span></span>
                  </button>))}
              </div>
            </section>)}
        </div>
      </main>
    </div>
  )
}
