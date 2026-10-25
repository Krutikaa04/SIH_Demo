import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { FastForward, RotateCcw, ShieldAlert, ShieldCheck, X, Zap } from 'lucide-react'
import { api, post } from '../api'
import { useToast } from '../toast'
import { cx } from '../ui'

/** Presenter controls. Hidden until Demo mode is switched on, so everyday users never see them. */
export default function DemoDock({ offset, onClose }: { offset: number; onClose: () => void }) {
  const nav = useNavigate()
  const loc = useLocation()
  const { overlapToast, push } = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const note = (t: string) => <span className="text-slate-600">{t}</span>

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name)
    try { await fn() } finally { setBusy('') }
  }
  const simulate = () => run('sim', async () => {
    const r = await post('/simulate/complaint')
    if (r.overlaps?.length) r.overlaps.forEach((o: any) => overlapToast(o.pair_id))
    else push({ kind: 'info', title: 'Complaint filed — no overlap found', body: note(r.case.case_id) })
  })
  const timeMachine = () => run('time', async () => {
    const r = await post('/admin/clock', { add_days: 7 })
    push({ kind: 'info', title: 'Time machine: +7 days', body: note(`Demo date is now ${r.now.slice(0, 10)}. The deadline engine has re-checked every case.`) })
  })
  const verifyAll = () => run('verify', async () => {
    const r = await api('/audit/verify')
    r.ok
      ? push({ kind: 'info', title: 'Audit trail intact', body: note(`${r.checked} records verified — hash chain unbroken.`) })
      : push({ kind: 'overlap', title: 'Tampering detected', body: <span className="text-slate-700">Record #{r.first_break.seq} of {r.first_break.case_id}: {r.first_break.reason}.</span>, to: `/cases/${r.first_break.case_id}`, cta: 'Open case' })
  })
  const tamper = () => run('tamper', async () => {
    const m = loc.pathname.match(/^\/cases\/(.+)$/)
    const r = await post('/admin/tamper', m ? { case_id: decodeURIComponent(m[1]), seq: 2 } : {})
    push({ kind: 'warn', title: 'Demo: a record was altered', body: note(`Record #${r.seq} of ${r.case_id} was changed directly in the database. Now run “Verify audit trail”.`) })
  })
  const restore = () => run('restore', async () => {
    const r = await post('/admin/restore-tamper')
    push({ kind: 'info', title: r.restored && r.verification?.ok ? 'Audit trail restored and re-verified' : 'Audit trail status',
      body: note(r.restored && r.verification?.ok ? `Tampered record restored. ${r.verification.checked} records verified.` : (r.message || `${r.verification?.checked} records verified.`)) })
  })
  const reset = () => run('reset', async () => {
    await post('/admin/reset')
    push({ kind: 'info', title: 'Demo reset', body: note('Pristine seeded data restored.') })
    nav('/')
  })

  const items = [
    { k: 'sim', icon: Zap, tone: 'text-saffron', label: 'File a new complaint', sub: 'Runs the real pipeline and may raise an overlap', fn: simulate },
    { k: 'time', icon: FastForward, tone: 'text-blue-600', label: 'Jump 7 days ahead', sub: 'Deadlines pass, escalations fire', fn: timeMachine },
    null,
    { k: 'verify', icon: ShieldCheck, tone: 'text-emerald-600', label: 'Verify the audit trail', sub: 'Re-checks every record’s hash', fn: verifyAll },
    { k: 'tamper', icon: ShieldAlert, tone: 'text-red-600', label: 'Tamper with a record', sub: 'Edits the database behind the app’s back', fn: tamper },
    { k: 'restore', icon: RotateCcw, tone: 'text-emerald-600', label: 'Restore and re-verify', sub: 'Undo the tampering', fn: restore },
    null,
    { k: 'reset', icon: RotateCcw, tone: 'text-slate-500', label: 'Reset all demo data', sub: 'Back to the starting position', fn: reset },
  ]

  return (
    <div className="fixed bottom-20 right-4 z-30 md:bottom-6 md:right-6">
      {open && (
        <div className="toast-in mb-2 w-[300px] overflow-hidden rounded-xl border border-line bg-sheet shadow-xl">
          <div className="flex items-center justify-between border-b border-line bg-slate-100/70 px-4 py-2.5">
            <span className="eyebrow">Presenter controls</span>
            <button onClick={onClose} className="text-xs font-medium text-slate-500 hover:text-slate-900">Turn off demo mode</button>
          </div>
          <ul className="p-1.5">
            {items.map((it, n) => it ? (
              <li key={it.k}>
                <button onClick={it.fn} disabled={!!busy} className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-100 disabled:opacity-50">
                  <it.icon size={16} className={cx('mt-0.5 shrink-0', it.tone, busy === it.k && 'animate-pulse')} />
                  <span><span className="block text-sm font-semibold text-slate-800">{it.label}</span><span className="block text-xs text-slate-500">{it.sub}</span></span>
                </button>
              </li>) : <li key={n} className="my-1 border-t border-line" />)}
          </ul>
        </div>)}
      <div className="flex justify-end">
        <button onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className="flex items-center gap-2 rounded-full bg-navy py-2 pl-2 pr-4 text-sm font-semibold text-white shadow-lg ring-1 ring-white/10 transition hover:bg-navy-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-saffron">{open ? <X size={15} /> : <Zap size={15} />}</span>
          Demo tools{offset > 0 && <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] num">+{offset}d</span>}
        </button>
      </div>
    </div>
  )
}
