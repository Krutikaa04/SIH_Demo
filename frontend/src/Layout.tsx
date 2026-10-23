import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Bell, BarChart3, FilePlus2, Building2, FolderOpen, GitMerge, LayoutDashboard, FlaskConical, Search, Zap, RotateCcw, FastForward, ChevronDown, ShieldCheck, ShieldAlert, UserCog, Clock3 } from 'lucide-react'
import { post, api, setRole, useApi, useRole } from './api'
import { useToast } from './toast'
import { ago, cx } from './ui'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/cases', label: 'Cases', icon: FolderOpen },
  { to: '/register', label: 'Register complaint', icon: FilePlus2 },
  { to: '/overlaps', label: 'Overlaps', icon: GitMerge, badge: 'overlaps' },
  { to: '/institutions', label: 'Institutions', icon: Building2 },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/alerts', label: 'Alerts', icon: Bell, badge: 'alerts' },
]

export default function Layout() {
  const nav = useNavigate()
  const loc = useLocation()
  const { overlapToast, push } = useToast()
  const me = useRole()
  const meta = useApi<any>('/meta', false)
  const overlaps = useApi<any>('/overlaps')
  const alerts = useApi<any>('/alerts?limit=6')
  const clock = useApi<any>('/clock')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [bell, setBell] = useState(false)
  const [demo, setDemo] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)
  const demoRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBell(false)
      if (demoRef.current && !demoRef.current.contains(e.target as Node)) setDemo(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') setDemo((v) => !v) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const counts: Record<string, number> = {
    overlaps: (overlaps.data?.items || []).filter((c: any) => c.status === 'OPEN').length,
    alerts: alerts.data?.unread || 0,
  }
  const offset = clock.data?.offset_days || 0
  const roleLabel = (meta.data?.roles || []).find((r: any) => r.code === me.role)?.label || me.role

  async function simulate() {
    setBusy(true); setDemo(false)
    try {
      const r = await post('/simulate/complaint')
      if (r.overlaps?.length) r.overlaps.forEach((o: any) => overlapToast(o.pair_id))
      else push({ kind: 'info', title: 'Complaint filed — no overlap found', body: <span className="text-slate-600">{r.case.case_id}</span> })
    } finally { setBusy(false) }
  }
  async function timeMachine() {
    setDemo(false)
    const r = await post('/admin/clock', { add_days: 7 })
    push({ kind: 'info', title: 'Time machine: +7 days', body: <span className="text-slate-600">Demo date is now {r.now.slice(0, 10)}. SLA engine has re-evaluated every case.</span> })
  }
  async function reset() {
    setDemo(false)
    await post('/admin/reset')
    push({ kind: 'info', title: 'Demo reset', body: <span className="text-slate-600">Pristine seeded data restored.</span> })
    nav('/')
  }
  async function verifyAll() {
    setDemo(false)
    const r = await api('/audit/verify')
    r.ok
      ? push({ kind: 'info', title: 'Audit trail intact', body: <span className="text-slate-600">{r.checked} records verified — hash chain unbroken.</span> })
      : push({ kind: 'overlap', title: 'Tampering detected', body: <span className="text-slate-700">Record #{r.first_break.seq} of {r.first_break.case_id}: {r.first_break.reason}.</span>, to: `/cases/${r.first_break.case_id}`, cta: 'Open case' })
  }
  async function tamper() {
    setDemo(false)
    const m = loc.pathname.match(/^\/cases\/(.+)$/)
    const r = await post('/admin/tamper', m ? { case_id: decodeURIComponent(m[1]), seq: 2 } : {})
    push({ kind: 'warn', title: 'Demo: a record was altered', body: <span className="text-slate-600">Record #{r.seq} of {r.case_id} was changed directly in the database. Now run “Verify audit trail”.</span> })
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden w-60 shrink-0 flex-col bg-navy text-slate-200 md:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 ring-1 ring-white/15">
            <ShieldCheck size={20} className="text-amber-400" />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-bold tracking-tight text-white">AICTE ICMD</div>
            <div className="text-[10.5px] text-slate-300/80">Complaint Monitoring Dashboard</div>
          </div>
        </div>
        <nav className="mt-2 flex-1 space-y-1 px-3">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                isActive ? 'bg-white/12 text-white shadow-inner' : 'text-slate-300 hover:bg-white/6 hover:text-white')}>
              <n.icon size={18} />
              <span className="flex-1">{n.label}</span>
              {n.badge && counts[n.badge] > 0 && (
                <span className={cx('rounded-full px-1.5 py-0.5 text-[10.5px] font-bold num',
                  n.badge === 'overlaps' ? 'bg-red-500 text-white' : 'bg-amber-400 text-navy')}>{counts[n.badge]}</span>)}
            </NavLink>
          ))}
        </nav>
        <div className="m-3 rounded-lg bg-white/6 p-3 text-[11px] leading-relaxed text-slate-300 ring-1 ring-white/10">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-amber-300"><FlaskConical size={13} /> Prototype</div>
          Synthetic data. All institutions are fictional. Runs fully offline.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
          <form className="relative max-w-md flex-1" onSubmit={(e) => { e.preventDefault(); const t = q.trim(); nav(t.split(/\s+/).length >= 3 && !/^[\w/-]+$/.test(t) ? `/cases?nl=${encodeURIComponent(t)}` : `/cases?q=${encodeURIComponent(t)}`) }}>
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search, or ask: pending RB cases in Western region older than 30 days"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-navy-2 focus:bg-white focus:ring-2 focus:ring-navy-2/15" />
          </form>
          <div className="ml-auto flex items-center gap-2">
            {offset > 0 && (
              <span title="Demo clock is advanced. Use Demo > Reset to return." className="flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
                <Clock3 size={13} /> Demo date +{offset}d
              </span>)}

            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 pl-2.5">
              <UserCog size={15} className="text-slate-400" />
              <select value={me.role} onChange={(e) => setRole({ role: e.target.value, region: e.target.value === 'REGIONAL' ? (me.region || 'Western') : '' })}
                title="Viewing as (prototype role switcher)"
                className="max-w-[150px] cursor-pointer bg-transparent py-2 pr-1.5 text-sm font-medium text-slate-700 outline-none">
                {(meta.data?.roles || [{ code: 'SENIOR', label: 'Senior Management' }]).map((r: any) => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
              {me.role === 'REGIONAL' && (
                <select value={me.region} onChange={(e) => setRole({ role: 'REGIONAL', region: e.target.value })}
                  className="cursor-pointer border-l border-slate-200 bg-transparent py-2 pl-2 pr-1.5 text-sm font-medium text-slate-700 outline-none">
                  {(meta.data?.regions || []).map((r: any) => <option key={r.name} value={r.name}>{r.name}</option>)}
                </select>)}
            </div>

            <button onClick={simulate} disabled={busy}
              className="flex items-center gap-2 rounded-lg bg-saffron px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60">
              <Zap size={16} className={busy ? 'animate-pulse' : ''} /> <span className="hidden lg:inline">Simulate New Complaint</span><span className="lg:hidden">Simulate</span>
            </button>

            <div className="relative" ref={bellRef}>
              <button onClick={() => setBell((v) => !v)} className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100">
                <Bell size={20} />
                {counts.alerts > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white num">{counts.alerts}</span>}
              </button>
              {bell && (
                <div className="toast-in absolute right-0 top-11 z-30 w-[380px] overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-slate-200">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                    <span className="text-sm font-semibold">Alerts</span>
                    <button className="text-xs font-medium text-navy-2 hover:underline" onClick={() => { setBell(false); nav('/alerts') }}>View all</button>
                  </div>
                  <ul className="max-h-96 divide-y divide-slate-100 overflow-auto">
                    {(alerts.data?.items || []).map((a: any) => (
                      <li key={a.id}>
                        <button className="flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50"
                          onClick={() => { setBell(false); post(`/alerts/${a.id}/read`).then(alerts.reload); nav(a.link) }}>
                          <span className={cx('mt-1 h-2 w-2 shrink-0 rounded-full', a.severity === 'HIGH' ? 'bg-red-500' : 'bg-amber-500', a.read && 'opacity-30')} />
                          <span className="min-w-0 flex-1">
                            <span className={cx('block text-[13px] leading-snug', a.read ? 'text-slate-500' : 'font-semibold text-slate-800')}>{a.message}</span>
                            <span className="mt-0.5 block truncate text-xs text-slate-500">{a.institution_name || a.case_id || ''}</span>
                            <span className="text-[11px] text-slate-400">{ago(a.created_at)}</span>
                          </span>
                        </button>
                      </li>))}
                    {(alerts.data?.items || []).length === 0 && <li className="p-6 text-center text-sm text-slate-400">No alerts.</li>}
                  </ul>
                </div>)}
            </div>

            <div className="relative" ref={demoRef}>
              <button onClick={() => setDemo((v) => !v)}
                className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Demo <ChevronDown size={14} />
              </button>
              {demo && (
                <div className="toast-in absolute right-0 top-11 z-30 w-64 rounded-xl bg-white p-1.5 shadow-xl ring-1 ring-slate-200">
                  <button onClick={simulate} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"><Zap size={15} className="text-saffron" /> Simulate new complaint</button>
                  <button onClick={timeMachine} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"><FastForward size={15} className="text-blue-600" /> Time machine: +7 days</button>
                  <div className="my-1 border-t border-slate-100" />
                  <button onClick={verifyAll} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"><ShieldCheck size={15} className="text-emerald-600" /> Verify audit trail</button>
                  <button onClick={tamper} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"><ShieldAlert size={15} className="text-red-600" /> Tamper with a record</button>
                  <div className="my-1 border-t border-slate-100" />
                  <button onClick={reset} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"><RotateCcw size={15} className="text-slate-500" /> Reset demo data</button>
                  <div className="px-3 pb-1.5 pt-1 text-[11px] text-slate-400">Shortcut: Ctrl+Shift+D · Viewing as {roleLabel}</div>
                </div>)}
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6"><Outlet /></main>
      </div>
    </div>
  )
}
