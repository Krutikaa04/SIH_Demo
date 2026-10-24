import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BadgeCheck, Bell, ChevronDown, FilePlus2, Inbox, Siren, Sparkles } from 'lucide-react'
import { useApi } from '../api'
import Analytics from '../components/Analytics'
import { BUREAU_NAMES, Card, EmptyState, ErrorBox, Loading, PageHeader, Segmented, Stat, StatusChip, ago, cx, dueText, greeting } from '../ui'

const longDate = (s: string) => new Date(s).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

/** The one alarm the problem statement asks for, kept word for word. */
export function CoordinationCallout({ children, to = '/overlaps', cta = 'Review overlaps' }: { children: React.ReactNode; to?: string; cta?: string }) {
  return (
    <Link to={to} className="group relative flex flex-wrap items-center gap-x-5 gap-y-3 overflow-hidden rounded-xl bg-red-600 p-5 text-white shadow-md transition hover:shadow-lg"
      style={{ backgroundImage: 'repeating-linear-gradient(135deg, rgb(255 255 255 / .045) 0 2px, transparent 2px 11px)' }}>
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/15"><Siren size={22} /></div>
      <div className="min-w-0 flex-1 basis-72">
        <div className="font-display text-[1.25rem] font-semibold leading-tight">Potential Overlapping Cases — Coordination Required</div>
        <div className="mt-1 text-[14px] leading-snug text-red-50/95">{children}</div>
      </div>
      <span className="flex items-center gap-2 rounded-lg bg-sheet px-4 py-2.5 text-sm font-semibold text-red-700 transition group-hover:bg-white">{cta} <ArrowRight size={15} /></span>
    </Link>
  )
}

function TodoRow({ c, kind }: { c: any; kind: 'overdue' | 'coordinate' | 'soon' }) {
  const others: string[] = c.overlap?.other_bureaus || []
  const bar = kind === 'overdue' ? 'border-l-red-500' : kind === 'coordinate' ? 'border-l-indigo-500' : 'border-l-orange-400'
  return (
    <li>
      <Link to={`/cases/${c.case_id}`} className={cx('group grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 border-l-[3px] px-5 py-3.5 transition hover:bg-slate-50', bar)}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="case-id text-navy-2">{c.case_id}</span>
            <StatusChip status={c.status} />
          </div>
          <div className="mt-1 truncate text-[15px] font-medium text-slate-900">{c.institution.name}</div>
          <div className="mt-0.5 truncate text-[13px] text-slate-500">
            {kind === 'coordinate'
              ? <>Also being handled by {others.map((b, i) => <span key={b}>{i > 0 && ', '}<b className="font-semibold text-slate-700">{b}</b></span>)}. Coordinate before acting.</>
              : <>Next step: <span className="text-slate-700">{c.next_action || 'Review the case'}</span></>}
          </div>
        </div>
        <div className="flex items-center gap-3 text-right">
          <span className={cx('text-[13px] font-semibold num', c.sla?.state === 'BREACHED' ? 'text-red-600' : c.sla?.state === 'NEARING' ? 'text-orange-600' : 'text-slate-500')}>{dueText(c.sla)}</span>
          <ArrowRight size={16} className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-600" />
        </div>
      </Link>
    </li>
  )
}

function OfficerHome({ d }: { d: any }) {
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
  const empty = {
    overdue: ['Nothing is overdue', 'Every case in your Bureau is within its prescribed time. Well done.'],
    coordinate: ['No overlaps on your desk', 'None of your open cases is being handled in parallel by another Bureau.'],
    soon: ['Nothing is close to its due date', 'No case has used 75% or more of its time yet.'],
  }[tab]

  return (
    <div className="mx-auto max-w-[1240px] space-y-6">
      <PageHeader eyebrow={`${desk.name} · ${longDate(d.as_of)}`} title={`${greeting()}.`}
        subtitle={desk.overdue > 0 ? <>You have <b className="font-semibold text-red-700">{desk.overdue} overdue</b> {desk.overdue === 1 ? 'case' : 'cases'} and {desk.in_overlap} that overlap with other Bureaus. Start with the list below.</>
          : 'Nothing is overdue. Here is what is on your desk.'}
        actions={<Link to="/register" className="btn btn-accent"><FilePlus2 size={16} /> Add a complaint</Link>} />

      <div className="rise rise-1 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open on your desk" value={desk.open} to={`/cases?bureau=${b}&status=Pending`} hint="not yet closed" />
        <Stat label="Past due date" value={desk.overdue} tone="red" to={`/cases?bureau=${b}&overdue=1`} hint={desk.escalated ? `${desk.escalated} already escalated` : 'none escalated'} />
        <Stat label="Due soon" value={desk.nearing} tone="amber" to={`/cases?bureau=${b}&nearing=1`} hint="75% of the time used" />
        <Stat label="Need coordination" value={desk.in_overlap} tone="plum" to={`/cases?bureau=${b}&overlap=1&status=Pending`} hint="shared with another Bureau" />
      </div>

      {desk.in_overlap > 0 && (
        <div className="rise rise-2">
          <CoordinationCallout to={`/cases?bureau=${b}&overlap=1&status=Pending`} cta="See my cases">
            {desk.in_overlap} of your cases concern institutions that other Bureaus are also dealing with. Check with them before you act.
          </CoordinationCallout>
        </div>)}

      <div className="rise rise-3 grid gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-8" pad={false}
          title="Your to-do list" subtitle="The most urgent first. Select a case to open it."
          right={<Link to={viewAll} className="text-[13px] font-semibold text-navy-2 hover:underline">See all {total(tab)}</Link>}>
          <div className="px-5 pb-3 pt-3">
            <Segmented label="To-do groups" value={tab} onChange={setTab}
              options={[['overdue', <>Overdue <span className="num ml-1 text-xs opacity-70">{total('overdue')}</span></>],
                ['coordinate', <>Coordinate <span className="num ml-1 text-xs opacity-70">{total('coordinate')}</span></>],
                ['soon', <>Due soon <span className="num ml-1 text-xs opacity-70">{total('soon')}</span></>]] as const} />
          </div>
          {cur.loading && !cur.data ? <div className="p-5"><Loading /></div> : (cur.data?.items || []).length === 0
            ? <EmptyState icon={BadgeCheck} title={empty[0]}>{empty[1]}</EmptyState>
            : <ul className="divide-y divide-line border-t border-line">{cur.data.items.map((c: any) => <TodoRow key={c.case_id} c={c} kind={tab} />)}</ul>}
        </Card>

        <div className="space-y-5 lg:col-span-4">
          <Card title="Waiting for you" pad={false}>
            <ul className="divide-y divide-line">
              <li><Link to="/alerts" className="flex items-center gap-3 px-5 py-3 transition hover:bg-slate-50">
                <Bell size={17} className="text-slate-400" /><span className="flex-1 text-sm font-medium text-slate-800">New alerts</span>
                <span className="font-display num text-xl font-semibold">{alerts.data?.unread ?? 0}</span></Link></li>
              <li><Link to="/unmatched" className="flex items-center gap-3 px-5 py-3 transition hover:bg-slate-50">
                <Inbox size={17} className="text-slate-400" /><span className="flex-1 text-sm font-medium text-slate-800">Complaints to match</span>
                <span className="font-display num text-xl font-semibold">{unmatched.data?.counts?.OPEN ?? 0}</span></Link></li>
            </ul>
            {(alerts.data?.items || []).slice(0, 3).map((a: any) => (
              <Link key={a.id} to={a.link} className="block border-t border-line px-5 py-2.5 text-[13px] leading-snug text-slate-600 transition hover:bg-slate-50">
                <span className="line-clamp-2 font-medium text-slate-800">{a.message}</span>
                <span className="text-xs text-slate-400">{a.institution_name || a.case_id} · {ago(a.created_at)}</span>
              </Link>))}
          </Card>

          <Card title={`Latest in ${b}`} subtitle={BUREAU_NAMES[b]}>
            {mine.length === 0 ? <p className="text-sm text-slate-400">No recent activity yet.</p> : (
              <ol className="space-y-3.5 border-l border-line pl-4">
                {mine.map((a: any, i: number) => (
                  <li key={i} className="relative text-sm">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-slate-300 ring-4 ring-sheet" />
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
          className="flex w-full items-center gap-3 rounded-xl border border-dashed border-slate-300 px-5 py-4 text-left transition hover:border-slate-400 hover:bg-sheet/60">
          <Sparkles size={18} className="text-saffron" />
          <span className="flex-1"><span className="font-display text-[1.0625rem] font-semibold">The wider picture</span>
            <span className="block text-[13px] text-slate-500">Numbers and charts for every Bureau, region and institution</span></span>
          <ChevronDown size={18} className={cx('text-slate-400 transition', wide && 'rotate-180')} />
        </button>
        {wide && <div className="mt-5"><Analytics d={d} /></div>}
      </div>
    </div>
  )
}

function OverviewHome({ d }: { d: any }) {
  const t = d.totals
  const regional = d.role === 'REGIONAL'
  const rate = t.received ? Math.round((t.disposed / t.received) * 100) : 0
  const dot: any = { red: 'bg-red-500', amber: 'bg-orange-400', blue: 'bg-blue-500', green: 'bg-emerald-500' }
  return (
    <div className="mx-auto max-w-[1360px] space-y-6">
      <PageHeader eyebrow={`${regional ? `Regional Office · ${d.region}` : 'Senior Management'} · ${longDate(d.as_of)}`} title="Today at a glance"
        subtitle={regional ? `You see only complaints about institutions in the ${d.region} region and can add remarks. Case actions stay with the Bureaus.`
          : 'Every Bureau in one view. You can decide in Coordination Rooms and escalate cases; day-to-day case actions stay with the Bureaus.'}
        actions={<span className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Live</span>} />

      {d.briefing?.length > 0 && (
        <Card className="rise rise-1" title={<span className="flex items-center gap-2"><Sparkles size={16} className="text-saffron" /> What stands out today</span>}
          right={<span className="hidden text-[11px] text-slate-400 sm:block">written automatically from live data</span>}>
          <ol className="grid gap-x-10 gap-y-3 md:grid-cols-2">
            {d.briefing.map((b: any, i: number) => (
              <li key={i}>
                <Link to={b.link} className="group flex gap-3 text-[15px] leading-snug text-slate-700 hover:text-slate-900">
                  <span className="font-display mt-px w-6 shrink-0 text-lg font-semibold leading-none text-slate-300 num">{String(i + 1).padStart(2, '0')}</span>
                  <span className="flex-1"><span className={cx('mr-2 inline-block h-2 w-2 rounded-full align-middle', dot[b.tone] || 'bg-slate-400')} /><span className="group-hover:underline">{b.text}</span></span>
                </Link>
              </li>))}
          </ol>
        </Card>)}

      <div className="rise rise-2 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Cases still open" value={t.pending} tone="blue" to="/cases?status=Pending" hint={`of ${t.received} received`} />
        <Stat label="Past due date" value={t.beyond_sla} tone="red" to="/cases?overdue=1" hint="beyond the prescribed timeline" />
        <Stat label="Overlaps to coordinate" value={d.overlap.open_clusters} tone="plum" to="/overlaps" hint={`${d.overlap.cases_involved} cases involved`} />
        <Stat label="Closed so far" value={`${rate}%`} tone="green" to="/cases?status=Disposed" hint={`${t.disposed} cases disposed`} />
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
