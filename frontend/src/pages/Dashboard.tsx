import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertOctagon, ArrowRight, BadgeCheck, Bell, ChevronDown, Clock, FilePlus2, FolderOpen, GitMerge, Inbox, Siren, Sparkles } from 'lucide-react'
import { useApi, useAuth } from '../api'
import Analytics from '../components/Analytics'
import { BUREAU_NAMES, Card, Chakra, CountUp, EmptyState, ErrorBox, Gauge, Loading, Segmented, Stat, StatusChip, ago, cx, dueText, greeting, tint } from '../ui'

const longDate = (s: string) => new Date(s).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

/** The one alarm the problem statement asks for, kept word for word. */
export function CoordinationCallout({ children, to = '/overlaps', cta = 'Review overlaps' }: { children: React.ReactNode; to?: string; cta?: string }) {
  return (
    <Link to={to} className="group relative flex flex-wrap items-center gap-x-5 gap-y-3 overflow-hidden rounded-2xl p-5 text-white shadow-lg transition duration-300 hover:-translate-y-0.5 hover:shadow-xl"
      style={{ background: 'radial-gradient(420px 200px at 100% 0%, rgb(255 138 31 / .55), transparent 65%), linear-gradient(115deg, #7f1226 0%, #c21f3a 55%, #e5484d 100%)', boxShadow: '0 20px 50px -22px rgb(217 45 67 / .8), inset 0 1px 0 rgb(255 255 255 / .22)' }}>
      <span className="pointer-events-none absolute inset-0 opacity-[.07]" style={{ backgroundImage: 'repeating-linear-gradient(135deg, #fff 0 2px, transparent 2px 11px)' }} />
      <div className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15 shadow-[inset_0_0_0_1px_rgb(255_255_255/.25)]"><Siren size={23} className="pulse-red rounded-full" /></div>
      <div className="relative min-w-0 flex-1 basis-72">
        <div className="font-display text-[1.3125rem] font-bold leading-tight tracking-tight">Potential Overlapping Cases — Coordination Required</div>
        <div className="mt-1 text-[14px] leading-snug text-white/85">{children}</div>
      </div>
      <span className="relative flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-red-700 shadow-lg transition group-hover:bg-red-50">{cta} <ArrowRight size={15} className="transition group-hover:translate-x-0.5" /></span>
    </Link>
  )
}

function TodoRow({ c, kind }: { c: any; kind: 'overdue' | 'coordinate' | 'soon' }) {
  const others: string[] = c.overlap?.other_bureaus || []
  const color = kind === 'overdue' ? '#ec4658' : kind === 'coordinate' ? '#8445f5' : '#ff8a1f'
  const breached = c.sla?.state === 'BREACHED'
  const dueColor = breached ? '#ec4658' : c.sla?.state === 'NEARING' ? '#ff8a1f' : '#8792b8'
  return (
    <li>
      <Link to={`/cases/${c.case_id}`} className="group relative grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-4 transition duration-200 hover:bg-slate-50">
        <span className="absolute inset-y-3 left-0 w-1 rounded-r-full transition-all group-hover:inset-y-2" style={{ background: color, boxShadow: `0 0 14px ${tint(color, 70)}` }} />
        <div className="min-w-0 pl-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="case-id text-navy-2">{c.case_id}</span>
            <StatusChip status={c.status} />
          </div>
          <div className="mt-1.5 truncate text-[15.5px] font-semibold text-slate-900">{c.institution.name}</div>
          <div className="mt-0.5 truncate text-[13px] text-slate-500">
            {kind === 'coordinate'
              ? <>Also being handled by {others.map((b, i) => <span key={b}>{i > 0 && ', '}<b className="font-semibold text-slate-700">{b}</b></span>)}. Coordinate before acting.</>
              : <>Next step: <span className="text-slate-700">{c.next_action || 'Review the case'}</span></>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full px-2.5 py-1 text-[12px] font-bold num" style={{ background: tint(dueColor, 14), color: `color-mix(in srgb, ${dueColor} 80%, var(--color-ink))`, boxShadow: `inset 0 0 0 1px ${tint(dueColor, 30)}` }}>{dueText(c.sla)}</span>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-slate-400 transition group-hover:bg-navy group-hover:text-white"><ArrowRight size={15} /></span>
        </div>
      </Link>
    </li>
  )
}

/** A glass tile that sits on the hero. */
function HeroStat({ label, value, to, tone }: { label: string; value: number; to: string; tone?: string }) {
  return (
    <Link to={to} className="glass group relative overflow-hidden rounded-2xl px-4 py-3.5 transition duration-200 hover:-translate-y-1 hover:bg-white/[.13]">
      <div className="text-[10.5px] font-bold uppercase tracking-[.12em] text-white/60">{label}</div>
      <div className="font-display num mt-1 text-[2.25rem] font-bold leading-none" style={{ color: tone || '#fff', textShadow: tone ? `0 0 24px ${tone}66` : undefined }}><CountUp value={value} /></div>
    </Link>
  )
}

function OfficerHome({ d }: { d: any }) {
  const { user } = useAuth()
  const desk = d.desk
  const b = desk.bureau
  const [tab, setTab] = useState<'overdue' | 'coordinate' | 'soon'>('overdue')
  const [wide, setWide] = useState(false)
  const lists = {
    overdue: useApi<any>(`/cases?bureau=${b}&overdue=1&sort=due_asc&page_size=8`),
    coordinate: useApi<any>(`/cases?bureau=${b}&overlap=1&status=Pending&page_size=8`),
    soon: useApi<any>(`/cases?bureau=${b}&nearing=1&page_size=8`),
  }
  const alerts = useApi<any>('/alerts?unread=1&limit=4')
  const unmatched = useApi<any>('/unmatched')
  const cur = lists[tab]
  const total = (k: keyof typeof lists) => lists[k].data?.total ?? ({ overdue: desk.overdue, coordinate: desk.in_overlap, soon: desk.nearing } as any)[k]
  const viewAll = { overdue: `/cases?bureau=${b}&overdue=1`, coordinate: `/cases?bureau=${b}&overlap=1&status=Pending`, soon: `/cases?bureau=${b}&nearing=1` }[tab]
  const mine = (d.activity || []).filter((a: any) => a.bureau === b).slice(0, 5)
  const onTrack = desk.open ? Math.round((100 * (desk.open - desk.overdue)) / desk.open) : 100
  const empty = {
    overdue: ['Nothing is overdue', 'Every case in your Bureau is within its prescribed time. Well done.'],
    coordinate: ['No overlaps on your desk', 'None of your open cases is being handled in parallel by another Bureau.'],
    soon: ['Nothing is close to its due date', 'No case has used 75% or more of its time yet.'],
  }[tab]

  return (
    <div className="mx-auto max-w-[1280px] space-y-7">
      <section className="mesh rise overflow-hidden rounded-3xl p-6 md:p-9">
        <Chakra className="spin-slow pointer-events-none absolute -right-16 -top-20 h-80 w-80 text-white/[.07]" />
        <div className="relative flex flex-wrap items-center justify-between gap-x-10 gap-y-7">
          <div className="min-w-0 max-w-xl">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.16em] text-white/60"><span className="h-px w-6 bg-saffron" />{desk.name} · {longDate(d.as_of)}</div>
            <h1 className="font-display mt-3 text-[2.25rem] font-extrabold leading-[1.05] tracking-tight md:text-[3rem]">{greeting()},<br /><span className="text-gradient">{user?.display_name}</span></h1>
            <p className="mt-4 text-[15.5px] leading-relaxed text-white/75">
              {desk.overdue > 0
                ? <>You have <b className="font-bold text-[#ffb066]">{desk.overdue} overdue</b> {desk.overdue === 1 ? 'case' : 'cases'} and {desk.in_overlap} that overlap with other Bureaus. Start with the list below.</>
                : 'Nothing is overdue. Here is what is on your desk.'}
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <Link to="/register" className="btn btn-accent !px-5 !py-3"><FilePlus2 size={17} /> Add a complaint</Link>
              <Link to={`/cases?bureau=${b}&status=Pending`} className="btn glass !px-5 !py-3 text-white hover:!bg-white/15"><FolderOpen size={17} /> Open my cases</Link>
            </div>
          </div>
          <div className="flex items-center gap-7">
            <Gauge value={onTrack} size={160} sub="of your cases on track" />
          </div>
        </div>
      </section>

      <div className="rise rise-1 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open on your desk" value={desk.open} icon={FolderOpen} to={`/cases?bureau=${b}&status=Pending`} hint="not yet closed" />
        <Stat label="Past due date" value={desk.overdue} tone="red" icon={AlertOctagon} to={`/cases?bureau=${b}&overdue=1`} hint={desk.escalated ? `${desk.escalated} already escalated` : 'none escalated'} />
        <Stat label="Due soon" value={desk.nearing} tone="amber" icon={Clock} to={`/cases?bureau=${b}&nearing=1`} hint="75% of the time used" />
        <Stat label="Need coordination" value={desk.in_overlap} tone="plum" icon={GitMerge} to={`/cases?bureau=${b}&overlap=1&status=Pending`} hint="shared with another Bureau" />
      </div>

      {desk.in_overlap > 0 && (
        <div className="rise rise-2">
          <CoordinationCallout to={`/cases?bureau=${b}&overlap=1&status=Pending`} cta="See my cases">
            {desk.in_overlap} of your cases concern institutions that other Bureaus are also dealing with. Check with them before you act.
          </CoordinationCallout>
        </div>)}

      <div className="rise rise-3 grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-8" pad={false}
          title="Your to-do list" subtitle="The most urgent first. Select a case to open it."
          right={<Link to={viewAll} className="text-[13px] font-semibold text-navy-2 hover:underline">See all {total(tab)}</Link>}>
          <div className="px-5 pb-4 pt-3">
            <Segmented label="To-do groups" value={tab} onChange={setTab}
              options={[['overdue', <>Overdue <span className="num ml-1 text-xs opacity-70">{total('overdue')}</span></>],
                ['coordinate', <>Coordinate <span className="num ml-1 text-xs opacity-70">{total('coordinate')}</span></>],
                ['soon', <>Due soon <span className="num ml-1 text-xs opacity-70">{total('soon')}</span></>]] as const} />
          </div>
          {cur.loading && !cur.data ? <div className="p-5"><Loading /></div> : (cur.data?.items || []).length === 0
            ? <EmptyState icon={BadgeCheck} title={empty[0]}>{empty[1]}</EmptyState>
            : <ul className="divide-y divide-line border-t border-line">{cur.data.items.map((c: any) => <TodoRow key={c.case_id} c={c} kind={tab} />)}</ul>}
        </Card>

        <div className="space-y-6 lg:col-span-4">
          <Card title="Waiting for you" pad={false}>
            <ul className="divide-y divide-line">
              <li><Link to="/alerts" className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-slate-50">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-orange-100 text-orange-600"><Bell size={17} /></span><span className="flex-1 text-sm font-semibold text-slate-800">New alerts</span>
                <span className="font-display num text-2xl font-bold">{alerts.data?.unread ?? 0}</span></Link></li>
              <li><Link to="/unmatched" className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-slate-50">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-100 text-blue-600"><Inbox size={17} /></span><span className="flex-1 text-sm font-semibold text-slate-800">Complaints to match</span>
                <span className="font-display num text-2xl font-bold">{unmatched.data?.counts?.OPEN ?? 0}</span></Link></li>
            </ul>
            {(alerts.data?.items || []).slice(0, 3).map((a: any) => (
              <Link key={a.id} to={a.link} className="block border-t border-line px-5 py-3 text-[13px] leading-snug text-slate-600 transition hover:bg-slate-50">
                <span className="line-clamp-2 font-semibold text-slate-800">{a.message}</span>
                <span className="text-xs text-slate-400">{a.institution_name || a.case_id} · {ago(a.created_at)}</span>
              </Link>))}
          </Card>

          <Card title={`Latest in ${b}`} subtitle={BUREAU_NAMES[b]}>
            {mine.length === 0 ? <p className="text-sm text-slate-400">No recent activity yet.</p> : (
              <ol className="space-y-4 border-l border-line pl-5">
                {mine.map((a: any, i: number) => (
                  <li key={i} className="relative text-sm">
                    <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-navy ring-4 ring-sheet" />
                    <Link to={`/cases/${a.case_id}`} className="case-id text-slate-900 hover:underline">{a.case_id}</Link>
                    <span className="ml-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">{a.action_type.replace('_', ' ')}</span>
                    <div className="truncate text-[13px] text-slate-600">{a.remarks}</div>
                    <div className="text-[11.5px] text-slate-400">{ago(a.ts)}</div>
                  </li>))}
              </ol>)}
          </Card>
        </div>
      </div>

      <div className="rise rise-4">
        <button onClick={() => setWide((v) => !v)} aria-expanded={wide}
          className="flex w-full items-center gap-4 rounded-2xl border border-dashed border-slate-300 px-5 py-4 text-left transition hover:border-navy hover:bg-sheet">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-orange-100 to-blue-100 text-navy-2"><Sparkles size={18} /></span>
          <span className="flex-1"><span className="font-display text-[1.0625rem] font-semibold">The wider picture</span>
            <span className="block text-[13px] text-slate-500">Numbers and charts for every Bureau, region and institution</span></span>
          <ChevronDown size={18} className={cx('text-slate-400 transition', wide && 'rotate-180')} />
        </button>
        {wide && <div className="mt-6"><Analytics d={d} /></div>}
      </div>
    </div>
  )
}

function OverviewHome({ d }: { d: any }) {
  const t = d.totals
  const regional = d.role === 'REGIONAL'
  const rate = t.received ? Math.round((t.disposed / t.received) * 100) : 0
  const trend = d.trend || []
  const dot: any = { red: '#ec4658', amber: '#ff8a1f', blue: '#3b5efa', green: '#10b981' }
  return (
    <div className="mx-auto max-w-[1360px] space-y-7">
      <section className="mesh rise overflow-hidden rounded-3xl p-6 md:p-9">
        <Chakra className="spin-slow pointer-events-none absolute -right-20 -top-24 h-96 w-96 text-white/[.07]" />
        <div className="relative flex flex-wrap items-center justify-between gap-x-10 gap-y-8">
          <div className="min-w-0 max-w-2xl">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.16em] text-white/60"><span className="h-px w-6 bg-saffron" />{regional ? `Regional Office · ${d.region}` : 'Senior Management'} · {longDate(d.as_of)}</span>
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-emerald-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Live</span>
            </div>
            <h1 className="font-display mt-3 text-[2.5rem] font-extrabold leading-[1.02] tracking-tight md:text-[3.5rem]">Today at <span className="text-gradient">a glance</span></h1>
            <p className="mt-4 text-[15.5px] leading-relaxed text-white/75">
              {regional ? `You see only complaints about institutions in the ${d.region} region and can add remarks. Case actions stay with the Bureaus.`
                : 'Every Bureau in one view. You can decide in Coordination Rooms and escalate cases; day-to-day case actions stay with the Bureaus.'}</p>
          </div>
          <Gauge value={rate} size={170} label={<CountUp value={`${rate}%`} />} sub="of all complaints closed" />
        </div>
        <div className="relative mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <HeroStat label="Still open" value={t.pending} to="/cases?status=Pending" />
          <HeroStat label="Past due date" value={t.beyond_sla} to="/cases?overdue=1" tone="#ff8a8f" />
          <HeroStat label="Overlaps to coordinate" value={d.overlap.open_clusters} to="/overlaps" tone="#ffb066" />
          <HeroStat label="Received in total" value={t.received} to="/cases" />
        </div>
      </section>

      {d.briefing?.length > 0 && (
        <Card className="rise rise-1" title={<span className="flex items-center gap-2"><Sparkles size={16} className="text-saffron" /> What stands out today</span>}
          right={<span className="hidden text-[11px] text-slate-400 sm:block">written automatically from live data</span>}>
          <ol className="grid gap-x-10 gap-y-4 md:grid-cols-2">
            {d.briefing.map((b: any, i: number) => (
              <li key={i}>
                <Link to={b.link} className="group flex gap-3.5 rounded-xl p-2 text-[15px] leading-snug text-slate-700 transition hover:bg-slate-50 hover:text-slate-900">
                  <span className="font-display mt-px w-7 shrink-0 text-xl font-bold leading-none text-slate-300 num transition group-hover:text-saffron">{String(i + 1).padStart(2, '0')}</span>
                  <span className="flex-1"><span className="mr-2 inline-block h-2 w-2 rounded-full align-middle" style={{ background: dot[b.tone] || '#8792b8', boxShadow: `0 0 8px ${dot[b.tone] || '#8792b8'}` }} />{b.text}</span>
                </Link>
              </li>))}
          </ol>
        </Card>)}

      <div className="rise rise-2 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Cases still open" value={t.pending} tone="blue" icon={FolderOpen} to="/cases?status=Pending" hint={`of ${t.received} received`} spark={trend.map((m: any) => m.received)} />
        <Stat label="Past due date" value={t.beyond_sla} tone="red" icon={AlertOctagon} to="/cases?overdue=1" hint="beyond the prescribed timeline" />
        <Stat label="Overlaps to coordinate" value={d.overlap.open_clusters} tone="plum" icon={GitMerge} to="/overlaps" hint={`${d.overlap.cases_involved} cases involved`} />
        <Stat label="Closed so far" value={`${rate}%`} tone="green" icon={BadgeCheck} to="/cases?status=Disposed" hint={`${t.disposed} cases disposed`} spark={trend.map((m: any) => m.disposed)} />
      </div>

      {d.overlap.open_clusters > 0 && (
        <div className="rise rise-3">
          <CoordinationCallout>{d.overlap.open_clusters} institutions have complaints being handled by more than one Bureau at the same time ({d.overlap.cases_involved} cases involved).</CoordinationCallout>
        </div>)}

      <div className="rise rise-4"><Analytics d={d} /></div>
    </div>
  )
}

export default function Dashboard() {
  const { data: d, error, loading } = useApi<any>('/dashboard/summary')
  if (loading && !d) return <Loading />
  if (error && !d) return <ErrorBox msg={error} />
  return d.desk ? <OfficerHome d={d} /> : <OverviewHome d={d} />
}
