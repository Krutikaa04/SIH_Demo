import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, FileDown, FilePlus2, FileSpreadsheet, Inbox, Search, Siren, Upload } from 'lucide-react'
import { api, post, useApi, useRole } from '../api'
import { BUREAU_NAMES, BureauBadge, Card, PageHeader, ScoreRing, Segmented, StatusChip, cx, fmtDate } from '../ui'

const today = () => new Date().toISOString().slice(0, 10)
const METHOD: Record<string, string> = { ID: 'matched by AICTE ID', NAME: 'matched by name', NAME_LOW: 'matched by name (low confidence)', MANUAL: 'chosen by you' }
const SEVERITY: [number, string][] = [[1, 'Low'], [2, 'Minor'], [3, 'Moderate'], [4, 'Serious'], [5, 'Critical']]

const SAMPLE_CSV = `institution_name,aicte_id,bureau,category,description,severity,source,received_on
"Sahyadri Govt Coll of Engg, Poona",,PGRC,Faculty Deficiency,"Parents report that regular faculty positions are vacant and visiting teachers take classes.",4,Email,
Kaveri Inst. of Tech Bangalore,,RB,Infrastructure Deficiency,"Laboratory equipment is not working and the library has no current books.",3,Letter,
Unknown Institute of Everything,,RB,Faculty Deficiency,"Shortage of qualified faculty reported by students.",3,Letter,
Narmada Govt College Lucknow,,PGRC,Not a category,"This row has an invalid category on purpose.",3,Letter,
`

function Label({ children, required, hint }: any) {
  return (
    <span className="mb-1.5 flex items-baseline justify-between gap-2 text-[13.5px] font-semibold text-slate-800">
      <span>{children}</span>
      {required ? <span className="text-[11px] font-medium text-slate-400">Required</span> : <span className="text-[11px] font-medium text-slate-400">{hint || 'Optional'}</span>}
    </span>
  )
}
function Section({ n, title, children }: { n: number; title: string; children: any }) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 flex items-center gap-3">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-navy font-display text-[15px] font-semibold text-white">{n}</span>
        <span className="font-display text-[1.1875rem] font-semibold text-slate-900">{title}</span>
      </legend>
      {children}
    </fieldset>
  )
}

export default function Register() {
  const [tab, setTab] = useState<'form' | 'import'>('form')
  return (
    <div className="mx-auto max-w-[1240px]">
      <PageHeader eyebrow="New complaint" title="Add a complaint"
        subtitle="Tell us what the complaint says. We check which institution it means, and warn you if another Bureau already has a similar case, before anything is saved."
        actions={<Segmented label="How many" value={tab} onChange={setTab}
          options={[['form', <span className="flex items-center gap-1.5"><FilePlus2 size={14} /> One complaint</span>], ['import', <span className="flex items-center gap-1.5"><FileSpreadsheet size={14} /> Many at once</span>]] as const} />} />
      {tab === 'form' ? <SingleForm /> : <BulkImport />}
    </div>
  )
}

// ------------------------------------------------------------------ single complaint ------------------

function SingleForm() {
  const me = useRole()
  const meta = useApi<any>('/meta', false)
  const nav = useNavigate()
  const isBureau = !['SENIOR', 'REGIONAL'].includes(me.role)
  const blank = { institution_name: '', aicte_id: '', institution_id: '', bureau: isBureau ? me.role : '', category: '', severity: 3, source: 'Letter', received_on: '', description: '' }
  const [f, setF] = useState<any>(blank)
  const [pv, setPv] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<any>(null)
  const [done, setDone] = useState<any>(null)
  const [parked, setParked] = useState<any>(null)
  const [manualQ, setManualQ] = useState('')
  const [showId, setShowId] = useState(false)
  const found = useApi<any>(manualQ.trim().length >= 2 ? `/institutions?q=${encodeURIComponent(manualQ)}` : null, false)
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }))

  useEffect(() => { if (isBureau) set('bureau', me.role) }, [me.role])
  // live check (debounced): institution match, open cases, potential overlaps
  useEffect(() => {
    if (!f.institution_name.trim() && !f.institution_id) { setPv(null); return }
    const t = setTimeout(() => { post('/complaints/preview', f).then(setPv).catch(() => {}) }, 450)
    return () => clearTimeout(t)
  }, [f.institution_name, f.aicte_id, f.institution_id, f.bureau, f.category, f.description, f.received_on])

  const matched = pv?.resolution
  const descOk = f.description.trim().length >= 10
  const canSubmit = !!matched && !!f.bureau && !!f.category && descOk && !busy
  const overlaps = pv?.potential_overlaps || []
  const affected = Array.from(new Set(overlaps.map((o: any) => o.bureau)))
  const canPark = pv?.ok && !matched && !!f.bureau && !!f.category && descOk && !busy && me.role !== 'REGIONAL'
  const missing = [!matched && 'the institution', !f.bureau && 'the receiving Bureau', !f.category && 'a category', !descOk && 'a description (at least 10 characters)'].filter(Boolean) as string[]

  async function submit() {
    setBusy(true); setErr(null)
    try { setDone(await post('/complaints', f)) } catch (e: any) { setErr(e) } finally { setBusy(false) }
  }
  async function saveForReview() {
    setBusy(true); setErr(null)
    try { setParked(await post('/complaints', { ...f, park_unmatched: true })) } catch (e: any) { setErr(e) } finally { setBusy(false) }
  }
  const again = () => { setDone(null); setParked(null); setF(blank); setPv(null); setShowId(false) }

  if (parked) {
    return (
      <Card className="rise mx-auto max-w-2xl">
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700"><Inbox size={24} /></div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[1.5rem] font-semibold">Saved for later: <span className="font-mono text-[1.25rem]">{parked.queue_id}</span></h2>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-600">We could not tell which institution this means, so no case exists yet. Someone can pick the institution from <b>Complaints to match</b>, and the complaint will then go through the normal overlap check.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button onClick={again} className="btn btn-primary">Add another complaint</button>
              <Link to="/unmatched" className="btn btn-ghost">Open complaints to match</Link>
            </div>
          </div>
        </div>
      </Card>)
  }

  if (done) {
    return (
      <Card className="rise mx-auto max-w-2xl">
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 size={26} /></div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[1.5rem] font-semibold">Registered as <Link className="font-mono text-[1.25rem] text-navy-2 hover:underline" to={`/cases/${done.case.case_id}`}>{done.case.case_id}</Link></h2>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{done.resolution.institution_name} ({METHOD[done.resolution.method]}). Assigned to {done.case.assigned_officer.name} in {done.case.bureau}. Due by {fmtDate(done.case.expected_disposal)}.</p>
            {done.overlaps.length > 0 ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
                <div className="flex items-center gap-2 font-display text-[1.1875rem] font-semibold text-red-800"><Siren size={19} /> Potential Overlapping Cases — Coordination Required</div>
                <p className="mt-1 text-[14px] text-red-800/90">{done.overlaps.length} overlap{done.overlaps.length > 1 ? 's' : ''} found. The Bureaus involved have been told.</p>
                <Link to={`/overlaps?open=${done.overlaps[0].cluster_id}`} className="btn btn-danger mt-3">See why and coordinate</Link>
              </div>) : <p className="mt-4 flex items-center gap-2 text-[14px] font-medium text-emerald-700"><CheckCircle2 size={16} /> No overlap with any open complaint at this institution.</p>}
            <div className="mt-5 flex flex-wrap gap-2">
              <button onClick={again} className="btn btn-primary">Add another complaint</button>
              <button onClick={() => nav(`/cases/${done.case.case_id}`)} className="btn btn-ghost">Open the case</button>
            </div>
          </div>
        </div>
      </Card>)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <form className="rise rise-1 space-y-8 rounded-xl border border-line bg-sheet p-6 shadow-sm lg:col-span-7" onSubmit={(e) => { e.preventDefault(); if (canSubmit) submit() }}>
        <Section n={1} title="Which institution is it about?">
          <label className="block"><Label required>Name, as written in the complaint</Label>
            <input value={f.institution_name} onChange={(e) => { set('institution_name', e.target.value); set('institution_id', '') }} placeholder="e.g. Sahyadri Govt Coll of Engg Poona" className="field !py-3 !text-base" autoComplete="off" />
            <span className="mt-1.5 block text-[12.5px] text-slate-500">Spelling mistakes, short forms and old city names are fine. We match it to the official record.</span></label>

          {pv?.ok && matched && (
            <div className={cx('flex items-start gap-3 rounded-lg border p-3 text-sm', matched.low_confidence ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900')}>
              <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
              <div><div className="font-semibold">{matched.institution_name}</div>
                <div className="text-xs opacity-80"><span className="num">{matched.institution_id}</span> · {METHOD[matched.method]} · {Math.round(matched.confidence)}% sure</div></div>
            </div>)}

          {pv?.ok && (!matched || matched.low_confidence) && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5">
              <div className="mb-2 flex items-center gap-2 text-[14px] font-semibold text-amber-900"><AlertTriangle size={16} /> {matched ? 'Please confirm the institution:' : 'We are not sure which one this is. Is it one of these?'}</div>
              <ul className="space-y-1.5">
                {pv.suggestions.map((s: any) => (
                  <li key={s.institution_id}><button type="button" onClick={() => { set('institution_id', s.institution_id); setManualQ('') }}
                    className="flex w-full items-center justify-between rounded-lg border border-line bg-white px-3 py-2.5 text-left text-sm transition hover:border-navy-2">
                    <span><span className="font-medium">{s.name}</span><span className="ml-2 text-xs text-slate-400">{s.region}</span></span><span className="num text-xs text-slate-500">{s.score}%</span></button></li>))}
              </ul>
              <div className="mt-2.5">
                <input value={manualQ} onChange={(e) => setManualQ(e.target.value)} placeholder="Or search the full list by name, city or ID…" className="field" />
                {manualQ.trim().length >= 2 && (
                  <ul className="mt-1.5 max-h-44 space-y-0.5 overflow-auto rounded-lg border border-line bg-white p-1">
                    {(found.data?.items || []).slice(0, 8).map((s: any) => (
                      <li key={s.aicte_id}><button type="button" onClick={() => { set('institution_id', s.aicte_id); setManualQ('') }} className="w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-slate-100">{s.name} <span className="text-xs text-slate-400">{s.aicte_id}</span></button></li>))}
                  </ul>)}
              </div>
            </div>)}

          {!showId ? <button type="button" onClick={() => setShowId(true)} className="text-[13px] font-semibold text-navy-2 hover:underline">The complaint quotes an AICTE ID</button> : (
            <label className="block"><Label>AICTE permanent ID</Label>
              <input value={f.aicte_id} onChange={(e) => set('aicte_id', e.target.value)} placeholder="1-1234567" className="field num sm:max-w-[240px]" /></label>)}
        </Section>

        <Section n={2} title="What is the complaint about?">
          <label className="block"><Label required>Category</Label>
            <select value={f.category} onChange={(e) => set('category', e.target.value)} className="field">
              <option value="">Choose one…</option>
              {(meta.data?.categories || []).map((c: any) => <option key={c.name}>{c.name}</option>)}
            </select></label>
          <div>
            <div><Label hint="How serious it sounds">Seriousness</Label>
              <div className="grid grid-cols-5 gap-1 rounded-lg border border-slate-300 bg-white p-1" role="radiogroup" aria-label="Seriousness">
                {SEVERITY.map(([n, l]) => (
                  <button type="button" key={n} role="radio" aria-checked={f.severity === n} onClick={() => set('severity', n)} title={`${n} of 5`}
                    className={cx('rounded-md py-2 text-[13px] font-semibold transition', f.severity === n ? (n >= 4 ? 'bg-red-600 text-white' : n === 3 ? 'bg-orange-500 text-white' : 'bg-navy text-white') : 'text-slate-500 hover:bg-slate-100')}>{l}</button>))}
              </div></div>
          </div>
          <label className="block"><Label required hint="">Describe the complaint</Label>
            <textarea rows={5} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="In a few sentences: what happened, and what does the complainant want?" className="field" />
            <span className={cx('mt-1 block text-right text-[12px] num', descOk ? 'text-emerald-700' : 'text-slate-400')}>{f.description.trim().length} characters{descOk ? '' : ' (at least 10)'}</span></label>
        </Section>

        <Section n={3} title="How did it reach you?">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block"><Label required>Receiving Bureau</Label>
              {isBureau
                ? <div className="field flex items-center gap-2 !bg-slate-100"><BureauBadge code={me.role} /><span className="truncate text-sm">{BUREAU_NAMES[me.role]}</span></div>
                : <select value={f.bureau} onChange={(e) => set('bureau', e.target.value)} className="field">
                  <option value="">Choose…</option>
                  {(meta.data?.bureaus || []).map((b: any) => <option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}
                </select>}</label>
            <label className="block"><Label>Arrived by</Label>
              <select value={f.source} onChange={(e) => set('source', e.target.value)} className="field">
                {(meta.data?.sources || ['Letter']).map((s: string) => <option key={s}>{s}</option>)}
              </select></label>
            <label className="block"><Label hint="Today if empty">Date received</Label>
              <input type="date" max={today()} value={f.received_on} onChange={(e) => set('received_on', e.target.value)} className="field" /></label>
          </div>
          <p className="text-[12.5px] text-slate-500">The time allowed to respond counts from the date received.</p>
        </Section>

        {err && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            {err.detail?.code === 'UNRESOLVED_INSTITUTION' ? 'We could not match the institution. Pick it from the suggestions, or save the complaint for later.' : err.message}
          </div>)}

        <div className="space-y-3 border-t border-line pt-5">
          <button type="submit" disabled={!canSubmit} className="btn btn-accent w-full !py-3.5 !text-base">
            {busy ? 'Saving…' : overlaps.length ? `Register — this will alert ${affected.join(', ')}` : 'Register the complaint'}
          </button>
          {!canSubmit && !busy && missing.length > 0 && <p className="text-center text-[13px] text-slate-500">Still needed: <span className="font-medium text-slate-700">{missing.join(', ')}</span>.</p>}
          {canPark && (
            <button type="button" onClick={saveForReview} className="btn btn-ghost w-full border-amber-300 !bg-amber-50 text-amber-900 hover:!bg-amber-100">
              <Inbox size={15} /> I cannot tell which institution — save it for someone to match</button>)}
        </div>
      </form>

      <div className="rise rise-2 space-y-5 lg:col-span-5 lg:sticky lg:top-0 lg:self-start">
        <Card title={<span className="flex items-center gap-2"><Search size={16} className="text-slate-400" /> What the system sees</span>} subtitle="Updates as you type. Nothing is saved yet.">
          {!pv && <p className="text-sm leading-relaxed text-slate-500">Start typing the institution’s name. We will show which institution it is, which complaints are already open there, and whether yours would overlap with one.</p>}
          {pv && !pv.ok && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{pv.message}</div>}

          {pv?.ok && !matched && <p className="text-sm text-slate-500">No institution matched yet. Use the suggestions on the left.</p>}

          {pv?.ok && matched && (
            <div className="space-y-5">
              <div>
                <div className="eyebrow mb-2">Already open at this institution · {pv.open_cases.length}{pv.open_cases.length >= 12 ? '+' : ''}</div>
                {pv.open_cases.length === 0 ? <p className="text-sm text-slate-500">Nothing is open. This would be the first.</p> : (
                  <ul className="max-h-52 divide-y divide-line overflow-auto rounded-lg border border-line bg-white">
                    {pv.open_cases.map((c: any) => (
                      <li key={c.case_id} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <BureauBadge code={c.bureau} /><Link to={`/cases/${c.case_id}`} className="case-id text-navy-2 hover:underline">{c.case_id}</Link>
                        <span className="min-w-0 flex-1 truncate text-slate-500">{c.category}</span><StatusChip status={c.status} />
                      </li>))}
                  </ul>)}
              </div>

              {!pv.ready ? (
                <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-500">Choose a category and describe the complaint, and we will check for overlaps.</p>
              ) : overlaps.length === 0 ? (
                <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800"><CheckCircle2 size={16} /> No overlap with any open complaint.</p>
              ) : (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3.5">
                  <div className="flex items-center gap-2 font-display text-[1.125rem] font-semibold text-red-800"><Siren size={17} /> Potential Overlapping Cases — Coordination Required</div>
                  <ul className="mt-3 space-y-2">
                    {overlaps.map((o: any) => (
                      <li key={o.case_id} className="flex items-center gap-3 rounded-lg border border-red-100 bg-white p-2.5">
                        <ScoreRing score={o.score} band={o.band} size={52} />
                        <div className="min-w-0 flex-1 text-sm">
                          <div className="flex items-center gap-2"><BureauBadge code={o.bureau} /><span className="case-id">{o.case_id}</span></div>
                          <div className="truncate text-xs text-slate-500">{o.category}</div>
                          <div className="mt-0.5 text-[11.5px] text-slate-500">
                            Similar in: {[...o.breakdown].sort((a: any, b: any) => b.points / b.max - a.points / a.max).slice(0, 2).map((b: any) => b.label.toLowerCase()).join(' and ')}
                          </div>
                        </div>
                      </li>))}
                  </ul>
                </div>)}
            </div>)}
        </Card>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ bulk import --------------------------

function BulkImport() {
  const [text, setText] = useState('')
  const [res, setRes] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [fileName, setFileName] = useState('')
  const [park, setPark] = useState(false)

  async function run(dry: boolean) {
    setBusy(true); setErr('')
    try { setRes(await post('/complaints/import', { csv_text: text, dry_run: dry, park_unmatched: park })) } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  function onFile(e: any) {
    const f: File = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setFileName(f.name)
    const rd = new FileReader()
    rd.onload = () => { setText(String(rd.result)); setRes(null) }
    rd.readAsText(f)
  }
  function template() {
    const url = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = 'complaints_template.csv'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
  }
  const chip = (s: string) => ({
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-700', created: 'border-blue-200 bg-blue-50 text-blue-700', needs_review: 'border-amber-200 bg-amber-50 text-amber-800',
    parked: 'border-amber-200 bg-amber-50 text-amber-800', error: 'border-red-200 bg-red-50 text-red-700',
  } as any)[s]
  const label = (s: string) => ({ ok: 'Ready', created: 'Added', needs_review: 'Needs a look', parked: 'Saved for later', error: 'Problem' } as any)[s]
  const ready = res?.dry_run ? res.counts.ok + (park ? res.counts.needs_review : 0) : 0

  return (
    <div className="space-y-6">
      <Card className="rise rise-1" title="1 · Bring your spreadsheet"
        subtitle="One row per complaint. Save the spreadsheet as CSV, then choose the file or paste its contents below."
        right={<div className="flex flex-wrap justify-end gap-2">
          <button onClick={() => { setText(SAMPLE_CSV); setRes(null); setFileName('sample') }} className="btn btn-ghost btn-sm">Try an example</button>
          <button onClick={template} className="btn btn-ghost btn-sm"><FileDown size={13} /> Blank template</button>
          <label className="btn btn-primary btn-sm cursor-pointer"><Upload size={13} /> Choose a file<input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} /></label>
        </div>}>
        <p className="mb-3 text-[13px] text-slate-500">Columns: <code className="rounded bg-slate-100 px-1 font-mono text-xs">institution_name, aicte_id, bureau, category, description, severity, source, received_on</code>. Only the institution, bureau, category and description are required. Bureau officers add to their own Bureau. Up to 500 rows.</p>
        <textarea value={text} onChange={(e) => { setText(e.target.value); setRes(null) }} rows={8} placeholder="Paste CSV here, or choose a file…" className="field font-mono !text-xs" />
        {fileName && <div className="mt-1 text-[12px] text-slate-400">Loaded: {fileName}</div>}
        {err && <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{err}</div>}
        <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm text-slate-700">
          <input type="checkbox" checked={park} onChange={(e) => { setPark(e.target.checked); setRes(null) }} className="mt-1 h-4 w-4" />
          <span>If an institution cannot be matched, <b>save that row for someone to match</b> instead of skipping it.</span></label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button disabled={!text.trim() || busy} onClick={() => run(true)} className="btn btn-primary">Check it first (nothing is saved)</button>
          <button disabled={!ready || busy} onClick={() => run(false)} className="btn btn-accent">Add {ready || ''} complaint{ready === 1 ? '' : 's'}</button>
        </div>
      </Card>

      {res && (
        <Card className="rise" title={res.dry_run ? '2 · What we found' : 'Done'} pad={false}
          right={<div className="flex flex-wrap justify-end gap-2 text-xs">
            {(['ok', 'created', 'needs_review', 'parked', 'error'] as const).filter((k) => res.counts[k] > 0).map((k) => <span key={k} className={cx('rounded-full border px-2.5 py-1 font-semibold', chip(k))}>{res.counts[k]} {label(k).toLowerCase()}</span>)}
            {res.counts.overlaps > 0 && <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 font-semibold text-red-700">{res.counts.overlaps} overlap{res.counts.overlaps > 1 ? 's' : ''}</span>}
          </div>}>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100/60 text-left">
                <tr>{['Row', 'Result', 'Institution as written', 'Matched to / issue', 'Bureau', 'Category', 'Overlaps'].map((h) => <th key={h} className="eyebrow px-4 py-2.5">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {res.results.map((r: any) => (
                  <tr key={r.row}>
                    <td className="num px-4 py-2.5 text-slate-400">{r.row}</td>
                    <td className="px-4 py-2.5"><span className={cx('rounded-[4px] border px-1.5 py-px text-xs font-semibold', chip(r.status))}>{label(r.status)}</span></td>
                    <td className="max-w-[220px] truncate px-4 py-2.5 text-slate-700">{r.institution_name}</td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {r.matched && <span>{r.matched}{r.case_id && <> → <Link className="case-id text-navy-2 hover:underline" to={`/cases/${r.case_id}`}>{r.case_id}</Link></>}</span>}
                      {r.queue_id && <span>Saved as <Link className="case-id text-navy-2 hover:underline" to="/unmatched">{r.queue_id}</Link></span>}
                      {r.message && <span className="text-red-700">{r.message}</span>}
                      {r.suggestions?.length > 0 && <div className="text-xs text-slate-500">Did you mean: {r.suggestions.map((s: any) => s.name).join(' · ')}?</div>}
                    </td>
                    <td className="px-4 py-2.5">{r.bureau && <BureauBadge code={r.bureau} />}</td>
                    <td className="px-4 py-2.5 text-slate-500">{r.category}</td>
                    <td className="num px-4 py-2.5">{r.overlaps > 0 ? <span className="font-bold text-red-600">{r.overlaps}</span> : <span className="text-slate-300">0</span>}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        </Card>)}
    </div>
  )
}
