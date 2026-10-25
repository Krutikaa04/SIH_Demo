import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Bell, BarChart3, Building2, ChevronDown, Clock3, Ellipsis, FilePlus2, FlaskConical, FolderOpen, GitMerge, House, Inbox, KeyRound, LogOut, Moon, Newspaper, Search, Send, Share2, ShieldCheck, Sun, Users as UsersIcon, X } from 'lucide-react'
import { post, signIn, signOut, useApi, useAuth } from './api'
import { ChangePasswordForm } from './components/ChangePassword'
import SearchBox from './components/SearchBox'
import DemoDock from './components/DemoDock'
import { useTheme } from './theme'
import { BUREAU_COLORS, BUREAU_NAMES, Chakra, Drawer, Logo, ago, cx } from './ui'

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
  { to: '/audit', label: 'Audit Vault', icon: ShieldCheck },
  { to: '/galaxy', label: 'Connection map', icon: Share2 },
  { to: '/briefings', label: 'Executive briefing', icon: Newspaper },
  { to: '/outbox', label: 'Sent messages', icon: Send },
  { to: '/users', label: 'People and access', icon: UsersIcon },
]

const monogram = (role: string) => ({ SENIOR: 'SM', REGIONAL: 'RO' } as any)[role] || role.slice(0, 2)
const store = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
}
const avatarBg = (role: string) => { const c = BUREAU_COLORS[role] || '#3347b5'; return `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 55%, #050918))` }

function Badge({ n, tone, dark }: { n: number; tone: 'overlaps' | 'alerts' | 'unmatched'; dark?: boolean }) {
  if (!n) return null
  return (
    <span className={cx('rounded-full px-1.5 py-px font-mono text-[10.5px] font-bold num',
      tone === 'overlaps' ? 'bg-red-500 text-white shadow-[0_0_12px_rgb(236_70_88/.65)]' : dark ? 'bg-white/15 text-white' : 'bg-navy text-white')}>{n}</span>
  )
}

export default function Layout() {
  const nav = useNavigate()
  const loc = useLocation()
  const [theme, toggleTheme] = useTheme()
  const { user: account, config } = useAuth()
  const me = { role: account!.role, region: account!.region }
  const [pwOpen, setPwOpen] = useState(false)
  const [switching, setSwitching] = useState('')
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
  const roleLabel = BUREAU_NAMES[me.role] || me.role
  const demoAccounts = config?.demo_mode ? (config.demo_accounts || []) : []
  const more = MORE.filter((n) => !(n.to === '/unmatched' && me.role === 'REGIONAL') && !(n.to === '/users' && me.role !== 'SENIOR'))
  const moreActive = more.some((n) => loc.pathname.startsWith(n.to))
  const moreBadge = counts.alerts + counts.unmatched

  const link = (n: NavItem) => (
    <NavLink key={n.to} to={n.to} end={n.end}
      className={({ isActive }) => cx('group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-all duration-200',
        isActive ? 'bg-white/[.09] text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/.1)]' : 'text-white/60 hover:bg-white/[.05] hover:text-white')}>
      {({ isActive }) => (<>
        {isActive && <span className="absolute inset-y-2.5 -left-3 w-1 rounded-r-full bg-saffron shadow-[0_0_14px_2px_rgb(255_138_31/.8)]" />}
        <n.icon size={18} strokeWidth={isActive ? 2.2 : 1.8} className={cx('transition', isActive ? 'text-saffron' : 'text-white/45 group-hover:text-white/80')} />
        <span className="flex-1">{n.label}</span>
        {n.badge && <Badge n={counts[n.badge]} tone={n.badge} dark />}
      </>)}
    </NavLink>
  )

  return (
    <div className="flex h-screen overflow-hidden">
      <a href="#main" className="sr-only z-50 rounded bg-navy px-3 py-2 text-white focus:not-sr-only focus:absolute focus:left-3 focus:top-3">Skip to content</a>

      {/* ---------------- sidebar: always midnight ---------------- */}
      <aside className="relative hidden w-[268px] shrink-0 flex-col overflow-hidden text-white md:flex"
        style={{ background: 'radial-gradient(420px 260px at 0% 0%, rgb(71 102 255 / .35), transparent 70%), radial-gradient(360px 300px at 100% 100%, rgb(255 138 31 / .14), transparent 70%), linear-gradient(180deg, #0a1240 0%, #070c24 100%)' }}>
        <Chakra className="spin-slow pointer-events-none absolute -bottom-28 -left-28 h-80 w-80 text-white/[.045]" />
        <button onClick={() => nav('/')} className="relative flex items-center gap-3 px-6 pb-5 pt-6 text-left">
          <Logo size={42} />
          <span className="leading-tight">
            <span className="block text-[10px] font-bold uppercase tracking-[.2em] text-white/45">AICTE · ICMD</span>
            <span className="font-display text-[1.3125rem] font-bold tracking-tight">Complaint Desk</span>
          </span>
        </button>
        <div className="mx-6 h-[2px] rounded-full opacity-80" style={{ background: 'linear-gradient(90deg, #ff8a1f 0 33%, rgb(255 255 255 / .85) 33% 66%, #10b981 66%)' }} />

        <nav className="relative mt-4 flex-1 space-y-1 overflow-y-auto px-3 py-1" aria-label="Main">
          {MAIN.map(link)}
          <div className="pt-5">
            <button onClick={toggleMore} aria-expanded={moreOpen || moreActive}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-white/45 transition hover:text-white/80">
              <span className="flex-1 text-[10.5px] font-bold uppercase tracking-[.16em]">More</span>
              {!(moreOpen || moreActive) && <Badge n={moreBadge} tone="alerts" dark />}
              <ChevronDown size={14} className={cx('transition', (moreOpen || moreActive) && 'rotate-180')} />
            </button>
            {(moreOpen || moreActive) && <div className="mt-1 space-y-1">{more.map(link)}</div>}
          </div>
        </nav>

        <div className="relative m-3 rounded-2xl p-3 glass">
          <div className="flex items-center gap-3">
            <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl font-mono text-[12px] font-bold text-white shadow-lg" style={{ background: avatarBg(me.role) }}>
              {monogram(me.role)}<span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0a1240] bg-emerald-400" />
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13.5px] font-semibold">{account!.display_name}</span>
              <span className="block truncate text-[11.5px] text-white/55">{roleLabel}{me.region ? ` · ${me.region}` : ''}</span>
            </span>
            <button onClick={() => signOut()} aria-label="Sign out" title="Sign out" className="rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white"><LogOut size={16} /></button>
          </div>
          <div className="mt-2.5 flex items-center gap-1.5 border-t border-white/10 pt-2 text-[10.5px] text-white/40"><FlaskConical size={11} /> Prototype · synthetic data · offline</div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---------------- top bar ---------------- */}
        <header className="topbar-glass relative z-20 flex items-center gap-3 border-b border-line/70 px-4 py-3 md:px-8">
          <button onClick={() => nav('/')} className="md:hidden" aria-label="Home"><Logo size={34} /></button>
          <SearchBox className="hidden max-w-xl flex-1 md:block" />
          <div className="flex-1 md:hidden" />
          <button onClick={() => setSearchOpen(true)} aria-label="Search" className="rounded-xl p-2 text-slate-600 hover:bg-slate-200/60 md:hidden"><Search size={20} /></button>

          <div className="ml-auto flex items-center gap-1.5 md:gap-2">
            <span className="hidden items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-700 lg:flex" title="Updates arrive instantly">
              <span className="relative grid h-2 w-2 place-items-center"><span className="absolute inset-0 rounded-full bg-emerald-500" style={{ animation: 'ripple 1.8s infinite' }} /><span className="h-2 w-2 rounded-full bg-emerald-500" /></span> Live
            </span>
            {offset > 0 && (
              <span title="The demo clock has been moved forward" className="hidden items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 sm:flex">
                <Clock3 size={13} /> +{offset} days
              </span>)}

            <button onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
              className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-sheet text-slate-600 shadow-sm transition hover:-translate-y-px hover:text-navy-2 hover:shadow-md">
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            <div className="relative" ref={bellRef}>
              <button onClick={() => { setBell((v) => !v); setAcct(false) }} aria-label={`Alerts${counts.alerts ? `, ${counts.alerts} unread` : ''}`}
                className="relative grid h-10 w-10 place-items-center rounded-xl border border-line bg-sheet text-slate-600 shadow-sm transition hover:-translate-y-px hover:text-navy-2 hover:shadow-md">
                <Bell size={18} />
                {counts.alerts > 0 && <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-red-500 px-1 font-mono text-[10px] font-bold text-white shadow-[0_0_12px_rgb(236_70_88/.7)] ring-2 ring-paper num">{counts.alerts}</span>}
              </button>
              {bell && (
                <div className="toast-in absolute right-0 top-12 z-30 w-[min(400px,92vw)] overflow-hidden rounded-2xl border border-line bg-sheet shadow-xl">
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
                        <button className="flex w-full gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
                          onClick={() => { setBell(false); post(`/alerts/${a.id}/read`).then(alerts.reload); nav(a.link) }}>
                          <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.severity === 'HIGH' ? 'bg-red-500' : 'bg-orange-400', a.read && 'opacity-25')} />
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
                className="flex items-center gap-2.5 rounded-xl border border-line bg-sheet py-1 pl-1 pr-2.5 shadow-sm transition hover:-translate-y-px hover:shadow-md md:pr-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg font-mono text-[11px] font-bold text-white" style={{ background: avatarBg(me.role) }}>{monogram(me.role)}</span>
                <span className="hidden text-left leading-tight md:block">
                  <span className="block max-w-[150px] truncate text-[13px] font-semibold text-slate-900">{account!.display_name}</span>
                  <span className="block max-w-[150px] truncate text-[11px] text-slate-500">{roleLabel}</span>
                </span>
                <ChevronDown size={14} className="text-slate-400" />
              </button>
              {acct && (
                <div className="toast-in absolute right-0 top-12 z-30 w-[min(340px,92vw)] overflow-hidden rounded-2xl border border-line bg-sheet shadow-xl">
                  <div className="mesh flex items-center gap-3 px-4 py-4">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl font-mono text-[13px] font-bold text-white shadow-lg" style={{ background: avatarBg(me.role) }}>{monogram(me.role)}</span>
                    <span className="min-w-0"><span className="block truncate font-display text-[1.0625rem] font-bold">{account!.display_name}</span>
                      <span className="block truncate text-[12px] text-white/65">{roleLabel}{me.region ? ` · ${me.region}` : ''} · <span className="font-mono">{account!.username}</span></span></span>
                  </div>
                  <div className="p-1.5">
                    <button onClick={() => { setAcct(false); setPwOpen(true) }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-800 hover:bg-slate-100"><KeyRound size={16} className="text-slate-400" /> Change password</button>
                    <button onClick={() => signOut()} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-800 hover:bg-slate-100"><LogOut size={16} className="text-slate-400" /> Sign out</button>
                  </div>
                  {demoAccounts.length > 0 && (
                    <div className="border-t border-line">
                      <div className="px-4 pb-1 pt-3"><div className="eyebrow">Switch demo account</div><p className="mt-0.5 text-[11.5px] leading-snug text-slate-500">Signs you out and in as another role (demo mode only).</p></div>
                      <ul className="max-h-[34vh] overflow-auto p-1.5">
                        {demoAccounts.filter((a) => (a.role !== 'REGIONAL' || a.region === 'Western') && a.username !== account!.username).map((a) => (
                          <li key={a.username}>
                            <button disabled={!!switching} onClick={async () => { setSwitching(a.username); try { await signIn(a.username, config!.demo_password || ''); setAcct(false) } catch { /* shown by the next request */ } finally { setSwitching('') } }}
                              className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-100 disabled:opacity-50">
                              <span className="grid h-7 w-7 place-items-center rounded-lg font-mono text-[10.5px] font-bold text-white" style={{ background: avatarBg(a.role) }}>{monogram(a.role)}</span>
                              <span className="flex-1 font-medium text-slate-800">{a.label}</span>
                              {switching === a.username && <span className="text-xs text-slate-400">…</span>}
                            </button>
                          </li>))}
                      </ul>
                    </div>)}
                  {config?.demo_mode && (
                    <button onClick={toggleDemo} role="switch" aria-checked={demo}
                      className="flex w-full items-center gap-3 border-t border-line px-4 py-3 text-left hover:bg-slate-50">
                      <span className="flex-1">
                        <span className="block text-sm font-semibold text-slate-800">Demo mode</span>
                        <span className="block text-xs text-slate-500">Show presenter controls (new complaint, time jump, reset)</span>
                      </span>
                      <span className={cx('relative h-5 w-9 rounded-full transition', demo ? 'bg-emerald-500' : 'bg-slate-300')}>
                        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', demo ? 'left-[18px]' : 'left-0.5')} />
                      </span>
                    </button>)}
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
        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 items-end border-t border-line bg-sheet/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
          {[MAIN[0], MAIN[1], MAIN[2], MAIN[3]].map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => cx('relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold', isActive ? 'text-navy-2' : 'text-slate-500', n.to === '/register' && '-mt-5')}>
              {({ isActive }) => (<>
                {n.to === '/register'
                  ? <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 text-white shadow-[0_10px_24px_-6px_rgb(255_138_31/.8)] ring-4 ring-sheet"><n.icon size={24} /></span>
                  : <n.icon size={21} strokeWidth={isActive ? 2.3 : 1.8} />}
                <span>{n.to === '/register' ? 'Add' : n.label}</span>
                {n.badge && counts[n.badge] > 0 && <span className="absolute right-[22%] top-1 rounded-full bg-red-500 px-1 font-mono text-[9px] font-bold text-white">{counts[n.badge]}</span>}
              </>)}
            </NavLink>))}
          <button onClick={() => setSheet(true)} className="relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold text-slate-500">
            <Ellipsis size={21} /><span>More</span>
            {moreBadge > 0 && <span className="absolute right-[22%] top-1 rounded-full bg-navy px-1 font-mono text-[9px] font-bold text-white">{moreBadge}</span>}
          </button>
        </nav>

        {sheet && (
          <div className="fixed inset-0 z-50 flex items-end md:hidden" role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-night-950/60 backdrop-blur-sm" onClick={() => setSheet(false)} />
            <div className="toast-in relative w-full rounded-t-3xl border-t border-line bg-sheet p-4 pb-8 shadow-xl">
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300" />
              <ul className="grid grid-cols-2 gap-2">
                {[MAIN[4], ...more].map((n) => (
                  <li key={n.to}>
                    <NavLink to={n.to} className="flex items-center gap-3 rounded-xl border border-line bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800">
                      <n.icon size={18} className="text-navy-2" /><span className="flex-1">{n.label}</span>{n.badge && <Badge n={counts[n.badge]} tone={n.badge} />}
                    </NavLink>
                  </li>))}
              </ul>
              <div className="mt-3 flex gap-2">
                <button onClick={toggleTheme} className="btn btn-ghost flex-1">{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />} {theme === 'dark' ? 'Light' : 'Dark'} theme</button>
                <button onClick={() => signOut()} className="btn btn-ghost flex-1"><LogOut size={16} /> Sign out</button>
              </div>
            </div>
          </div>)}
      </div>

      {demo && config?.demo_mode && <DemoDock offset={offset} onClose={toggleDemo} />}

      <Drawer open={pwOpen} onClose={() => setPwOpen(false)} width={440}
        title={<div><div className="eyebrow">Your account</div><div className="font-display text-[1.5rem] font-bold">Change password</div></div>}>
        <ChangePasswordForm onDone={() => setTimeout(() => setPwOpen(false), 1800)} />
      </Drawer>
    </div>
  )
}
