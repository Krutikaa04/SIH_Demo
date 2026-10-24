import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, FileDown, FilePlus2, FileSpreadsheet, Inbox, Search, Siren, Upload } from 'lucide-react'
import { api, post, useApi, useRole } from '../api'
import { BureauBadge, Card, ScoreRing, StatusChip, cx, fmtDate } from '../ui'

const today = () => new Date().toISOString().slice(0, 10)
const METHOD: Record<string, string> = { ID: 'matched by AICTE ID', NAME: 'matched by name', NAME_LOW: 'matched by name (low confidence)', MANUAL: 'selected manually' }

const SAMPLE_CSV = `institution_name,aicte_id,bureau,category,description,severity,source,received_on
"Sahyadri Govt Coll of Engg, Poona",,PGRC,Faculty Deficiency,"Parents report that regular faculty positions are vacant and visiting teachers take classes.",4,Email,
Kaveri Inst. of Tech Bangalore,,RB,Infrastructure Deficiency,"Laboratory equipment is not working and the library has no current books.",3,Letter,
Unknown Institute of Everything,,RB,Faculty Deficiency,"Shortage of qualified faculty reported by students.",3,Letter,
Narmada Govt College Lucknow,,PGRC,Not a category,"This row has an invalid category on purpose.",3,Letter,
`

function Label({ children }: any) {
  return <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">{children}</span>
}
const input = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-navy-2 focus:ring-2 focus:ring-navy-2/10'

export default function Register() {
  const [tab, setTab] = useState<'form' | 'import'>('form')
  return (
    <div className="mx-auto max-w-[1300px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Register complaint</h1>
          <p className="text-sm text-slate-500">New complaints go through the same matching pipeline: institution resolution, overlap scoring and alerts.</p>
        </div>
        <div className="flex rounded-lg bg-slate-200/70 p-1 text-sm">
          {([['form', 'One complaint', FilePlus2], ['import', 'Bulk import (CSV)', FileSpreadsheet]] as const).map(([k, l, Icon]) => (
            <button key={k} onClick={() => setTab(k)} className={cx('flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium', tab === k ? 'bg-white shadow-sm' : 'text-slate-500')}><Icon size={14} /> {l}</button>))}
        </div>
      </div>
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
  const canSubmit = !!matched && !!f.bureau && !!f.category && f.description.trim().length >= 10 && !busy
  const overlaps = pv?.potential_overlaps || []
  const affected = Array.from(new Set(overlaps.map((o: any) => o.bureau)))

  const canPark = pv?.ok && !matched && !!f.bureau && !!f.category && f.description.trim().length >= 10 && !busy && me.role !== 'REGIONAL'

  async function submit() {
    setBusy(true); setErr(null)
    try { setDone(await post('/complaints', f)) } catch (e: any) { setErr(e) } finally { setBusy(false) }
  }
  async function saveForReview() {
    setBusy(true); setErr(null)
    try { setParked(await post('/complaints', { ...f, park_unmatched: true })) } catch (e: any) { setErr(e) } finally { setBusy(false) }
  }

  if (parked) {
    return (
      <Card>
        <div className="flex items-start gap-4">
          <div className="rounded-full bg-amber-100 p-3 text-amber-600"><Inbox size={26} /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold">Saved for review: {parked.queue_id}</h2>
            <p className="mt-1 text-sm text-slate-600">The institution could not be matched with confidence, so no case was created yet. An official can pick the institution in the review queue, and the complaint then goes through the normal overlap check.</p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => { setParked(null); setF(blank); setPv(null) }} className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-2">Register another</button>
              <Link to="/unmatched" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-50">Open review queue</Link>
            </div>
          </div>
        </div>
      </Card>)
  }

  if (done) {
    return (
      <Card>
        <div className="flex items-start gap-4">
          <div className="rounded-full bg-emerald-100 p-3 text-emerald-600"><CheckCircle2 size={26} /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold">Complaint registered: <Link className="text-navy-2 hover:underline" to={`/cases/${done.case.case_id}`}>{done.case.case_id}</Link></h2>
            <p className="mt-1 text-sm text-slate-600">{done.resolution.institution_name} · {METHOD[done.resolution.method]} · assigned to {done.case.assigned_officer.name} ({done.case.bureau}) · due {fmtDate(done.case.expected_disposal)}</p>
            {done.overlaps.length > 0 ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
                <div className="flex items-center gap-2 font-bold text-red-700"><Siren size={18} /> Potential Overlapping Cases — Coordination Required</div>
                <p className="mt-1 text-sm text-red-700/90">{done.overlaps.length} overlap{done.overlaps.length > 1 ? 's' : ''} detected; the Bureaus involved have been alerted.</p>
                <Link to={`/overlaps?open=${done.overlaps[0].cluster_id}`} className="mt-3 inline-block rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-red-700">Why flagged &amp; coordinate</Link>
              </div>) : <p className="mt-3 text-sm text-emerald-700">No overlap with open complaints at this institution.</p>}
            <div className="mt-4 flex gap-2">
              <button onClick={() => { setDone(null); setF(blank); setPv(null) }} className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-2">Register another</button>
              <button onClick={() => nav(`/cases/${done.case.case_id}`)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-50">Open case</button>
            </div>
          </div>
        </div>
      </Card>)
  }

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <Card title="Complaint details" className="lg:col-span-6">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block"><Label>Receiving Bureau / Cell</Label>
              <select value={f.bureau} disabled={isBureau} onChange={(e) => set('bureau', e.target.value)} className={cx(input, isBureau && 'bg-slate-50')}>
                <option value="">Select…</option>
                {(meta.data?.bureaus || []).map((b: any) => <option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}
              </select></label>
            <label className="block"><Label>Source</Label>
              <select value={f.source} onChange={(e) => set('source', e.target.value)} className={input}>
                {(meta.data?.sources || ['Letter']).map((s: string) => <option key={s}>{s}</option>)}
              </select></label>
          </div>
          <label className="block"><Label>Institution name — exactly as written in the complaint</Label>
            <input value={f.institution_name} onChange={(e) => { set('institution_name', e.target.value); set('institution_id', '') }} placeholder="e.g. Sahyadri Govt Coll of Engg Poona" className={input} />
            <span className="mt-1 block text-[11px] text-slate-400">Spelling variants, abbreviations and old city names are fine; the system matches them to the master record.</span></label>
          <label className="block"><Label>AICTE Permanent ID (optional)</Label>
            <input value={f.aicte_id} onChange={(e) => set('aicte_id', e.target.value)} placeholder="1-1234567" className={cx(input, 'num')} /></label>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block sm:col-span-2"><Label>Category</Label>
              <select value={f.category} onChange={(e) => set('category', e.target.value)} className={input}>
                <option value="">Select…</option>
                {(meta.data?.categories || []).map((c: any) => <option key={c.name}>{c.name}</option>)}
              </select></label>
            <label className="block"><Label>Severity</Label>
              <select value={f.severity} onChange={(e) => set('severity', Number(e.target.value))} className={input}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}{n === 1 ? ' (low)' : n === 5 ? ' (critical)' : ''}</option>)}
              </select></label>
          </div>
          <label className="block"><Label>Date of receipt</Label>
            <input type="date" max={today()} value={f.received_on} onChange={(e) => set('received_on', e.target.value)} className={input} />
            <span className="mt-1 block text-[11px] text-slate-400">Leave empty for today. The prescribed timeline counts from this date.</span></label>
          <label className="block"><Label>Complaint description</Label>
            <textarea rows={5} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="What is the complaint about?" className={input} /></label>

          {err && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {err.detail?.code === 'UNRESOLVED_INSTITUTION' ? 'The institution could not be matched with confidence. Pick it from the suggestions on the right.' : err.message}
            </div>)}
          <button disabled={!canSubmit} onClick={submit}
            className="w-full rounded-lg bg-saffron py-3 text-sm font-semibold text-white shadow-sm hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? 'Registering…' : overlaps.length ? `Register — will alert ${affected.join(', ')}` : 'Register complaint'}
          </button>
          {canPark && (
            <button onClick={saveForReview}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 py-2.5 text-sm font-semibold text-amber-900 hover:bg-amber-100">
              <Inbox size={15} /> Cannot find the institution — save for review</button>)}
        </div>
      </Card>

      <div className="space-y-5 lg:col-span-6">
        <Card title={<span className="flex items-center gap-2"><Search size={15} className="text-slate-400" /> Live check</span>}
          right={<span className="text-[11px] text-slate-400">updates as you type · nothing is saved yet</span>}>
          {!pv && <p className="text-sm text-slate-400">Start typing the institution name to see who it is, what is already open there, and whether this complaint would overlap.</p>}

          {pv && !pv.ok && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{pv.message}</div>}

          {pv?.ok && matched && (
            <div className={cx('rounded-lg p-3 text-sm', matched.low_confidence ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-900')}>
              <div className="flex items-center gap-2 font-semibold"><CheckCircle2 size={16} /> {matched.institution_name}</div>
              <div className="mt-0.5 text-xs opacity-80"><span className="num">{matched.institution_id}</span> · {METHOD[matched.method]} · {Math.round(matched.confidence)}%</div>
            </div>)}

          {pv?.ok && (!matched || matched.low_confidence) && (
            <div className="mt-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-amber-800"><AlertTriangle size={15} /> {matched ? 'Confirm the institution:' : 'No confident match. Is it one of these?'}</div>
              <ul className="space-y-1.5">
                {pv.suggestions.map((s: any) => (
                  <li key={s.institution_id}><button onClick={() => { set('institution_id', s.institution_id); setManualQ('') }}
                    className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-navy-2 hover:bg-slate-50">
                    <span><span className="font-medium">{s.name}</span><span className="ml-2 text-xs text-slate-400">{s.region}</span></span><span className="num text-xs text-slate-500">{s.score}%</span></button></li>))}
              </ul>
              <div className="mt-2">
                <input value={manualQ} onChange={(e) => setManualQ(e.target.value)} placeholder="Or search the master list by name, city or ID…" className={input} />
                {manualQ.trim().length >= 2 && (
                  <ul className="mt-1.5 max-h-40 space-y-1 overflow-auto">
                    {(found.data?.items || []).slice(0, 8).map((s: any) => (
                      <li key={s.aicte_id}><button onClick={() => { set('institution_id', s.aicte_id); setManualQ('') }} className="w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-slate-100">{s.name} <span className="text-xs text-slate-400">{s.aicte_id}</span></button></li>))}
                  </ul>)}
              </div>
            </div>)}

          {pv?.ok && matched && (
            <>
              <div className="mt-4">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Already open at this institution: {pv.open_cases.length}{pv.open_cases.length >= 12 ? '+' : ''}
                </div>
                {pv.open_cases.length === 0 ? <p className="text-sm text-slate-500">No open complaints. This would be the first.</p> : (
                  <ul className="max-h-44 divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-100">
                    {pv.open_cases.map((c: any) => (
                      <li key={c.case_id} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <BureauBadge code={c.bureau} /><Link to={`/cases/${c.case_id}`} className="font-medium text-navy-2 hover:underline">{c.case_id}</Link>
                        <span className="min-w-0 flex-1 truncate text-slate-500">{c.category}</span><StatusChip status={c.status} />
                      </li>))}
                  </ul>)}
              </div>

              <div className="mt-4">
                {!pv.ready ? (
                  <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Choose a category and describe the complaint to run the overlap check.</p>
                ) : overlaps.length === 0 ? (
                  <p className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm font-medium text-emerald-800"><CheckCircle2 size={16} /> No overlap with open complaints.</p>
                ) : (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                    <div className="flex items-center gap-2 font-bold text-red-700"><Siren size={17} /> Potential Overlapping Cases — Coordination Required</div>
                    <ul className="mt-2 space-y-2">
                      {overlaps.map((o: any) => (
                        <li key={o.case_id} className="flex items-center gap-3 rounded-lg bg-white p-2.5 ring-1 ring-red-100">
                          <ScoreRing score={o.score} band={o.band} size={52} />
                          <div className="min-w-0 flex-1 text-sm">
                            <div className="flex items-center gap-2"><BureauBadge code={o.bureau} /><span className="font-semibold">{o.case_id}</span></div>
                            <div className="truncate text-xs text-slate-500">{o.category}</div>
                            <div className="mt-0.5 text-[11px] text-slate-500">
                              {[...o.breakdown].sort((a: any, b: any) => b.points / b.max - a.points / a.max).slice(0, 2).map((b: any) => b.label.toLowerCase()).join(' · ')}
                            </div>
                          </div>
                        </li>))}
                    </ul>
                  </div>)}
              </div>
            </>)}
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
    ok: 'bg-emerald-100 text-emerald-700', created: 'bg-blue-100 text-blue-700', needs_review: 'bg-amber-100 text-amber-800', parked: 'bg-amber-100 text-amber-800', error: 'bg-red-100 text-red-700',
  } as any)[s]
  const label = (s: string) => ({ ok: 'Ready', created: 'Created', needs_review: 'Needs review', parked: 'In review queue', error: 'Error' } as any)[s]
  const ready = res?.dry_run ? res.counts.ok + (park ? res.counts.needs_review : 0) : 0

  return (
    <div className="space-y-5">
      <Card title="1 · Provide a CSV"
        right={<div className="flex gap-2">
          <button onClick={() => { setText(SAMPLE_CSV); setRes(null); setFileName('sample') }} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50">Load sample</button>
          <button onClick={template} className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50"><FileDown size={13} /> Template</button>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md bg-navy px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-navy-2"><Upload size={13} /> Choose file<input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} /></label>
        </div>}>
        <p className="mb-2 text-xs text-slate-500">Columns: <code>institution_name, aicte_id, bureau, category, description, severity, source, received_on</code> (only the first, bureau, category and description are required; bureau roles import into their own Bureau). Max 500 rows.</p>
        <textarea value={text} onChange={(e) => { setText(e.target.value); setRes(null) }} rows={8} placeholder="Paste CSV here, or choose a file…" className={cx(input, 'font-mono text-xs')} />
        {fileName && <div className="mt-1 text-[11px] text-slate-400">Loaded: {fileName}</div>}
        {err && <div className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</div>}
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={park} onChange={(e) => { setPark(e.target.checked); setRes(null) }} className="mt-0.5" />
          <span>Save rows whose institution cannot be matched to the <b>review queue</b> instead of skipping them.</span></label>
        <div className="mt-3 flex gap-2">
          <button disabled={!text.trim() || busy} onClick={() => run(true)} className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-2 disabled:opacity-40">Validate (nothing is saved)</button>
          <button disabled={!ready || busy} onClick={() => run(false)} className="rounded-lg bg-saffron px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-40">Import {ready || ''} valid complaint{ready === 1 ? '' : 's'}</button>
        </div>
      </Card>

      {res && (
        <Card title={res.dry_run ? '2 · Validation result' : 'Import complete'}
          right={<div className="flex flex-wrap gap-3 text-xs">
            {(['ok', 'created', 'needs_review', 'parked', 'error'] as const).filter((k) => res.counts[k] > 0).map((k) => <span key={k} className={cx('rounded-full px-2.5 py-1 font-semibold', chip(k))}>{res.counts[k]} {label(k).toLowerCase()}</span>)}
            {res.counts.overlaps > 0 && <span className="rounded-full bg-red-100 px-2.5 py-1 font-semibold text-red-700">{res.counts.overlaps} overlap{res.counts.overlaps > 1 ? 's' : ''}</span>}
          </div>} pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-400">
                <tr>{['Row', 'Result', 'Institution as written', 'Matched to / issue', 'Bureau', 'Category', 'Overlaps'].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {res.results.map((r: any) => (
                  <tr key={r.row}>
                    <td className="num px-4 py-2.5 text-slate-400">{r.row}</td>
                    <td className="px-4 py-2.5"><span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', chip(r.status))}>{label(r.status)}</span></td>
                    <td className="max-w-[220px] truncate px-4 py-2.5 text-slate-700">{r.institution_name}</td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {r.matched && <span>{r.matched}{r.case_id && <> → <Link className="font-semibold text-navy-2 hover:underline" to={`/cases/${r.case_id}`}>{r.case_id}</Link></>}</span>}
                      {r.queue_id && <span>Saved as <Link className="font-semibold text-navy-2 hover:underline" to="/unmatched">{r.queue_id}</Link></span>}
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
