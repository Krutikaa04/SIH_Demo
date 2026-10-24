import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Bell, BarChart3, Building2, Check, ChevronDown, Clock3, Ellipsis, FilePlus2, FlaskConical, FolderOpen, GitMerge, House, Inbox, Newspaper, Search, Send, Share2, X } from 'lucide-react'
import { post, setRole, useApi, useRole } from './api'
import SearchBox from './components/SearchBox'
import DemoDock from './components/DemoDock'
import { BUREAU_COLORS, Logo, ago, cx } from './ui'

type NavItem = { to: string; label: string; icon: any; end?: boolean; badge?: 'overlaps' | 'alerts' | 'unmatched'; hint?: string }

const MAIN: NavItem[] = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/cases', label: 'Cases', icon: FolderOpen },
  { to: '/register', label: 'Add complaint', icon: FilePlus2 },
  { to: '/overlaps', label: 'Coordination', icon: GitMerge, badge: 'overlaps', hint: 'Cases that overlap' },
  { to: '/institutions', label: 'Institutions', icon: Building2 },
]
const MORE: NavItem[] = [
  { to: '/unmatched', label: 'Complaints to match', icon: Inbox, badge: 'unmatched' },
  { to: '/alerts', label: 'All alerts', icon: Bell, badge: 'alerts' },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/galaxy', label: 'Connection map', icon: Share2 },
  { to: '/briefings', label: 'Executive briefing', icon: Newspaper },
  { to: '/outbox', label: 'Sent messages', icon: Send },
]

const monogram = (role: string) => ({ SENIOR: 'SM', REGIONAL: 'RO' } as any)[role] || role.slice(0, 2)
const store = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
}

function Badge({ n, tone }: { n: number; tone: 'overlaps' | 'alerts' | 'unmatched' }) {
  if (!n) return null
  return <span className={cx('rounded-full px-1.5 py-px font-mono text-[10.5px] font-semibold num', tone === 'overlaps' ? 'bg-red-600 text-white' : 'bg-navy text-white')}>{n}</span>
}

export default function Layout() {
  const nav = useNavigate()
  const loc = useLocation()
  const me = useRole()
  const meta = useApi<any>('/meta', false)
  const overlaps = useApi<any>('/overlaps')
  const alerts = useApi<any>('/alerts?limit=6')
  const unmatched = useApi<any>('/unmatched')
  const clock = useApi<any>('/clock')
  const [bell, setBell] = useState(false)
  const [acct, setAcct] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(store.get('icmd.more') === '1')
  const [demo, setDemo] = useState(store.get('icmd.demo') === '1')
  const bellRef = useRef<HTMLDivElement>(null)
  const acctRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBell(false)
      if (acctRef.current && !acctRef.current.contains(e.target as Node)) setAcct(false)
    }
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setBell(false); setAcct(false); setSheet(false); setSearchOpen(false) }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') toggleDemo()
    }
    document.addEventListener('mousedown', h)
    window.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); window.removeEventListener('keydown', k) }
  })
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); setSheet(false) }, [loc.pathname])

  function toggleDemo() { setDemo((v) => { store.set('icmd.demo', v ? '0' : '1'); return !v }) }
  function toggleMore() { setMoreOpen((v) => { store.set('icmd.more', v ? '0' : '1'); return !v }) }

  const counts = {
    overlaps: (overlaps.data?.items || []).filter((c: any) => c.status === 'OPEN').length,
    alerts: alerts.data?.unread || 0,
    unmatched: unmatched.data?.counts?.OPEN || 0,
  }
  const offset = clock.data?.offset_days || 0
  const roles: any[] = meta.data?.roles || [{ code: 'SENIOR', label: 'Senior Management' }]
  const roleLabel = roles.find((r) => r.code === me.role)?.label || me.role
  const more = MORE.filter((n) => !(n.to === '/unmatched' && me.role === 'REGIONAL'))
  const moreActive = more.some((n) => loc.pathname.startsWith(n.to))
  const moreBadge = counts.alerts + counts.unmatched

  const link = (n: NavItem) => (
    <NavLink key={n.to} to={n.to} end={n.end}
      className={({ isActive }) => cx('group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium transition',
        isActive ? 'bg-sheet text-slate-900 shadow-sm ring-1 ring-line' : 'text-slate-600 hover:bg-white/60 hover:text-slate-900')}>
      {({ isActive }) => (<>
        {isActive && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-saffron" />}
        <n.icon size={18} strokeWidth={isActive ? 2.1 : 1.8} className={isActive ? 'text-navy-2' : 'text-slate-400 group-hover:text-slate-600'} />
        <span className="flex-1">{n.label}</span>
        {n.badge && <Badge n={counts[n.badge]} tone={n.badge} />}
      </>)}
    </NavLink>
  )

  return (
    <div className="flex h-screen overflow-hidden">
      <a href="#main" className="sr-only z-50 rounded bg-navy px-3 py-2 text-white focus:not-sr-only focus:absolute focus:left-3 focus:top-3">Skip to content</a>

      {/* ---------------- sidebar ---------------- */}
      <aside className="hidden w-[248px] shrink-0 flex-col border-r border-line bg-rail md:flex">
        <button onClick={() => nav('/')} className="flex items-center gap-3 px-5 pb-4 pt-6 text-left">
          <Logo size={38} />
          <span className="leading-tight">
            <span className="eyebrow block !text-[10px] !tracking-[.16em]">AICTE · ICMD</span>
            <span className="font-display text-[1.125rem] font-semibold text-slate-900">Complaint Desk</span>
          </span>
        </button>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Main">
          {MAIN.map(link)}
          <div className="pt-4">
            <button onClick={toggleMore} aria-expanded={moreOpen || moreActive}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-slate-500 hover:text-slate-900">
              <span className="eyebrow flex-1">More</span>
              {!(moreOpen || moreActive) && <Badge n={moreBadge} tone="alerts" />}
              <ChevronDown size={14} className={cx('transition', (moreOpen || moreActive) && 'rotate-180')} />
            </button>
            {(moreOpen || moreActive) && <div className="mt-0.5 space-y-0.5">{more.map(link)}</div>}
          </div>
        </nav>

        <div className="m-3 rounded-lg border border-dashed border-slate-300 p-3 text-[11.5px] leading-relaxed text-slate-500">
          <div className="mb-0.5 flex items-center gap-1.5 font-semibold text-slate-600"><FlaskConical size={12} /> Prototype</div>
          Synthetic data. Every institution here is fictional. Works fully offline.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---------------- top bar ---------------- */}
        <header className="relative z-20 flex items-center gap-3 border-b border-line bg-paper/85 px-4 py-3 backdrop-blur md:px-8">
          <button onClick={() => nav('/')} className="md:hidden" aria-label="Home"><Logo size={32} /></button>
          <SearchBox className="hidden max-w-xl flex-1 md:block" />
          <div className="flex-1 md:hidden" />
          <button onClick={() => setSearchOpen(true)} aria-label="Search" className="rounded-full p-2 text-slate-600 hover:bg-slate-200/60 md:hidden"><Search size={20} /></button>

          <div className="ml-auto flex items-center gap-1.5 md:gap-2.5">
            {offset > 0 && (
              <span title="The demo clock has been moved forward" className="hidden items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 sm:flex">
                <Clock3 size={13} /> +{offset} days
              </span>)}

            <div className="relative" ref={bellRef}>
              <button onClick={() => { setBell((v) => !v); setAcct(false) }} aria-label={`Alerts${counts.alerts ? `, ${counts.alerts} unread` : ''}`}
                className="relative rounded-full p-2 text-slate-600 transition hover:bg-slate-200/60">
                <Bell size={20} />
                {counts.alerts > 0 && <span className="absolute right-0 top-0 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-red-600 px-1 font-mono text-[10px] font-semibold text-white ring-2 ring-paper num">{counts.alerts}</span>}
              </button>
              {bell && (
                <div className="toast-in absolute right-0 top-12 z-30 w-[min(400px,92vw)] overflow-hidden rounded-xl border border-line bg-sheet shadow-xl">
                  <div className="flex items-center justify-between border-b border-line px-4 py-3">
                    <span className="font-display text-base font-semibold">Alerts for you</span>
                    <span className="flex gap-3 text-xs font-semibold">
                      {counts.alerts > 0 && <button className="text-slate-500 hover:text-slate-900" onClick={async () => { await post('/alerts/read-all'); alerts.reload() }}>Mark all read</button>}
                      <button className="text-navy-2 hover:underline" onClick={() => { setBell(false); nav('/alerts') }}>See all</button>
                    </span>
                  </div>
                  <ul className="max-h-[26rem] divide-y divide-line overflow-auto">
                    {(alerts.data?.items || []).map((a: any) => (
                      <li key={a.id}>
                        <button className="flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50"
                          onClick={() => { setBell(false); post(`/alerts/${a.id}/read`).then(alerts.reload); nav(a.link) }}>
                          <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.severity === 'HIGH' ? 'bg-red-500' : 'bg-amber-500', a.read && 'opacity-25')} />
                          <span className="min-w-0 flex-1">
                            <span className={cx('block text-[13.5px] leading-snug', a.read ? 'text-slate-500' : 'font-semibold text-slate-900')}>{a.message}</span>
                            <span className="mt-0.5 block truncate text-xs text-slate-500">{a.institution_name || a.case_id || ''}</span>
                            <span className="text-[11px] text-slate-400">{ago(a.created_at)}</span>
                          </span>
                        </button>
                      </li>))}
                    {(alerts.data?.items || []).length === 0 && <li className="p-8 text-center text-sm text-slate-400">You are all caught up.</li>}
                  </ul>
                </div>)}
            </div>

            <div className="relative" ref={acctRef}>
              <button onClick={() => { setAcct((v) => !v); setBell(false) }} aria-expanded={acct}
                className="flex items-center gap-2 rounded-full border border-line bg-sheet py-1 pl-1 pr-2.5 shadow-sm transition hover:border-slate-300 md:pr-3">
                <span className="grid h-7 w-7 place-items-center rounded-full font-mono text-[11px] font-semibold text-white" style={{ background: BUREAU_COLORS[me.role] || '#1b2547' }}>{monogram(me.role)}</span>
                <span className="hidden text-left leading-tight md:block">
                  <span className="block text-[11px] text-slate-500">Viewing as</span>
                  <span className="block max-w-[150px] truncate text-[13px] font-semibold text-slate-800">{roleLabel}{me.role === 'REGIONAL' && me.region ? ` · ${me.region}` : ''}</span>
                </span>
                <ChevronDown size={14} className="text-slate-400" />
              </button>
              {acct && (
                <div className="toast-in absolute right-0 top-12 z-30 w-[min(320px,92vw)] overflow-hidden rounded-xl border border-line bg-sheet shadow-xl">
                  <div className="border-b border-line bg-slate-100/60 px-4 py-3">
                    <div className="eyebrow">Who are you in this demo?</div>
                    <p className="mt-1 text-xs leading-snug text-slate-500">There is no login in the prototype. Pick a role to see the app exactly as that person would.</p>
                  </div>
                  <ul className="max-h-[50vh] overflow-auto p-1.5">
                    {roles.map((r: any) => (
                      <li key={r.code}>
                        <button onClick={() => { setRole({ role: r.code, region: r.code === 'REGIONAL' ? (me.region || 'Western') : '' }); if (r.code !== 'REGIONAL') setAcct(false) }}
                          className={cx('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-100', me.role === r.code && 'bg-slate-100')}>
                          <span className="grid h-7 w-7 place-items-center rounded-full font-mono text-[11px] font-semibold text-white" style={{ background: BUREAU_COLORS[r.code] || '#1b2547' }}>{monogram(r.code)}</span>
                          <span className="flex-1 font-medium text-slate-800">{r.label}</span>
                          {me.role === r.code && <Check size={16} className="text-emerald-600" />}
                        </button>
                      </li>))}
                  </ul>
                  {me.role === 'REGIONAL' && (
                    <label className="block border-t border-line px-4 py-3 text-sm">
                      <span className="eyebrow mb-1 block">Region</span>
                      <select value={me.region} onChange={(e) => setRole({ role: 'REGIONAL', region: e.target.value })} className="field">
                        {(meta.data?.regions || []).map((r: any) => <option key={r.name} value={r.name}>{r.name}</option>)}
                      </select>
                    </label>)}
                  <button onClick={toggleDemo} role="switch" aria-checked={demo}
                    className="flex w-full items-center gap-3 border-t border-line px-4 py-3 text-left hover:bg-slate-50">
                    <span className="flex-1">
                      <span className="block text-sm font-semibold text-slate-800">Demo mode</span>
                      <span className="block text-xs text-slate-500">Show presenter controls (new complaint, time jump, reset)</span>
                    </span>
                    <span className={cx('relative h-5 w-9 rounded-full transition', demo ? 'bg-emerald-600' : 'bg-slate-300')}>
                      <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', demo ? 'left-[18px]' : 'left-0.5')} />
                    </span>
                  </button>
                </div>)}
            </div>
          </div>
        </header>

        {/* mobile full-screen search */}
        {searchOpen && (
          <div className="fixed inset-0 z-50 bg-paper p-4 md:hidden">
            <div className="flex items-center gap-2">
              <SearchBox className="flex-1" autoFocus onDone={() => setSearchOpen(false)} />
              <button onClick={() => setSearchOpen(false)} className="rounded-full p-2 text-slate-600" aria-label="Close search"><X size={20} /></button>
            </div>
          </div>)}

        <main id="main" ref={mainRef} className="flex-1 overflow-auto px-4 pb-28 pt-6 md:px-8 md:pb-12 md:pt-8">
          <div key={loc.pathname}><Outlet /></div>
        </main>

        {/* ---------------- mobile bottom bar ---------------- */}
        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 items-end border-t border-line bg-sheet/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          {[MAIN[0], MAIN[1], MAIN[2], MAIN[3]].map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => cx('relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold', isActive ? 'text-navy-2' : 'text-slate-500', n.to === '/register' && '-mt-4')}>
              {({ isActive }) => (<>
                {n.to === '/register'
                  ? <span className="grid h-12 w-12 place-items-center rounded-full bg-saffron text-white shadow-lg ring-4 ring-sheet"><n.icon size={22} /></span>
                  : <n.icon size={21} strokeWidth={isActive ? 2.2 : 1.8} />}
                <span>{n.to === '/register' ? 'Add' : n.label}</span>
                {n.badge && counts[n.badge] > 0 && <span className="absolute right-[22%] top-1 rounded-full bg-red-600 px-1 font-mono text-[9px] font-semibold text-white">{counts[n.badge]}</span>}
              </>)}
            </NavLink>))}
          <button onClick={() => setSheet(true)} className="relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold text-slate-500">
            <Ellipsis size={21} /><span>More</span>
            {moreBadge > 0 && <span className="absolute right-[22%] top-1 rounded-full bg-navy px-1 font-mono text-[9px] font-semibold text-white">{moreBadge}</span>}
          </button>
        </nav>

        {sheet && (
          <div className="fixed inset-0 z-50 flex items-end md:hidden" role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-slate-950/45" onClick={() => setSheet(false)} />
            <div className="toast-in relative w-full rounded-t-2xl border-t border-line bg-sheet p-4 pb-8 shadow-xl">
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300" />
              <ul className="grid grid-cols-2 gap-2">
                {[MAIN[4], ...more].map((n) => (
                  <li key={n.to}>
                    <NavLink to={n.to} className="flex items-center gap-3 rounded-lg border border-line bg-white px-3 py-3 text-sm font-semibold text-slate-800">
                      <n.icon size={18} className="text-slate-500" /><span className="flex-1">{n.label}</span>{n.badge && <Badge n={counts[n.badge]} tone={n.badge} />}
                    </NavLink>
                  </li>))}
              </ul>
            </div>
          </div>)}
      </div>

      {demo && <DemoDock offset={offset} onClose={toggleDemo} />}
    </div>
  )
}
