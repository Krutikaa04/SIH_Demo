import { FormEvent, useState } from 'react'
import { Check, Circle } from 'lucide-react'
import { changePassword, signOut } from '../api'
import { PasswordField } from '../pages/Login'
import { Logo, cx } from '../ui'

export function ChangePasswordForm({ onDone, forced }: { onDone?: () => void; forced?: boolean }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const rules: [boolean, string][] = [
    [next.length >= 8, 'At least 8 characters'],
    [/[A-Za-z]/.test(next) && /\d/.test(next), 'Letters and numbers'],
    [next.length > 0 && next !== current, 'Different from the current password'],
    [next.length > 0 && next === again, 'Both new entries match'],
  ]
  const ok = !!current && rules.every(([v]) => v)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok) return
    setBusy(true); setErr('')
    try { await changePassword(current, next); setDone(true); onDone?.() }
    catch (ex: any) { setErr(ex.message) } finally { setBusy(false) }
  }
  if (done && !forced) return <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900" role="status"><b>Password changed.</b> Your other devices have been signed out.</div>

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <PasswordField id="cp-current" label={forced ? 'Temporary password' : 'Current password'} value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
      <PasswordField id="cp-new" label="New password" value={next} onChange={setNext} autoComplete="new-password" />
      <PasswordField id="cp-again" label="New password again" value={again} onChange={setAgain} autoComplete="new-password" />
      <ul className="grid gap-1 text-[12.5px]" aria-label="Password rules">
        {rules.map(([v, t]) => (
          <li key={t} className={cx('flex items-center gap-2', v ? 'text-emerald-700' : 'text-slate-500')}>
            {v ? <Check size={13} /> : <Circle size={11} />}{t}</li>))}
      </ul>
      {err && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{err}</div>}
      <button type="submit" disabled={!ok || busy} className="btn btn-primary w-full !py-3">{busy ? 'Saving…' : 'Save the new password'}</button>
    </form>
  )
}

/** Shown instead of the app while the account still has a temporary password. */
export default function ForcePasswordChange({ name }: { name: string }) {
  return (
    <div className="grid min-h-screen place-items-center px-5 py-10">
      <div className="w-full max-w-[440px]">
        <div className="mb-7 flex items-center gap-3"><Logo size={38} /><span className="font-display text-xl font-semibold">Complaint Desk</span></div>
        <h1 className="font-display text-[2rem] font-semibold leading-tight">Choose your own password</h1>
        <p className="mb-6 mt-2 text-[15px] leading-relaxed text-slate-600">Welcome, {name}. You signed in with a temporary password. Pick a new one that only you know, and you can carry on.</p>
        <div className="rounded-xl border border-line bg-sheet p-5 shadow-sm"><ChangePasswordForm forced /></div>
        <button onClick={signOut} className="mt-4 text-[13px] font-semibold text-slate-500 hover:text-slate-900">Sign out instead</button>
      </div>
    </div>
  )
}
