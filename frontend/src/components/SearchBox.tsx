import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, CornerDownLeft, FolderOpen, Search, Sparkles } from 'lucide-react'
import { api } from '../api'
import { BureauBadge, StatusChip, cx } from '../ui'

const TRY = [
  'pending RB cases in Western region older than 30 days',
  'overdue PGRC cases in south western region',
  'escalated faculty complaints',
  'ragging complaints in Bhopal',
]

type Hit = { kind: 'case' | 'institution' | 'ask' | 'text'; to: string; key: string; data?: any }

/** One box for everything: a case number, an institution, or a plain-English question. */
export default function SearchBox({ className, onDone, autoFocus }: { className?: string; onDone?: () => void; autoFocus?: boolean }) {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [cases, setCases] = useState<any[]>([])
  const [insts, setInsts] = useState<any[]>([])
  const [idx, setIdx] = useState(-1)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const seq = useRef(0)
  const text = q.trim()
  const sentence = text.split(/\s+/).length >= 3 && !/^[\w/-]+$/.test(text)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(el.tagName) && !el.isContentEditable) { e.preventDefault(); input.current?.focus() }
    }
    document.addEventListener('mousedown', h)
    window.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); window.removeEventListener('keydown', k) }
  }, [])

  useEffect(() => {
    if (text.length < 2 || sentence) { setCases([]); setInsts([]); return }
    const my = ++seq.current
    const t = setTimeout(async () => {
      try {
        const [c, i] = await Promise.all([
          api(`/cases?q=${encodeURIComponent(text)}&page_size=5`),
          api(`/institutions?q=${encodeURIComponent(text)}`),
        ])
        if (my === seq.current) { setCases(c.items || []); setInsts((i.items || []).slice(0, 4)) }
      } catch { /* the box simply shows no suggestions */ }
    }, 180)
    return () => clearTimeout(t)
  }, [text, sentence])

  const hits: Hit[] = []
  if (text) {
    cases.forEach((c) => hits.push({ kind: 'case', to: `/cases/${c.case_id}`, key: c.case_id, data: c }))
    insts.forEach((i) => hits.push({ kind: 'institution', to: `/institutions/${i.aicte_id}`, key: i.aicte_id, data: i }))
    hits.push(sentence ? { kind: 'ask', to: `/cases?nl=${encodeURIComponent(text)}`, key: 'ask' }
      : { kind: 'text', to: `/cases?q=${encodeURIComponent(text)}`, key: 'text' })
  }

  function go(to: string) { setOpen(false); setIdx(-1); setQ(''); input.current?.blur(); nav(to); onDone?.() }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); input.current?.blur() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(hits.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(-1, i - 1)) }
    else if (e.key === 'Enter' && text) { e.preventDefault(); go(idx >= 0 && hits[idx] ? hits[idx].to : (sentence ? `/cases?nl=${encodeURIComponent(text)}` : `/cases?q=${encodeURIComponent(text)}`)) }
  }

  return (
    <div ref={box} className={cx('relative', className)}>
      <label className="relative block">
        <span className="sr-only">Search cases and institutions</span>
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input ref={input} value={q} autoFocus={autoFocus} onChange={(e) => { setQ(e.target.value); setOpen(true); setIdx(-1) }}
          onFocus={() => setOpen(true)} onKeyDown={onKey} role="combobox" aria-expanded={open} aria-controls="search-results" autoComplete="off"
          placeholder="Find a case or institution, or ask a question…"
          className="w-full rounded-full border border-line bg-sheet py-2.5 pl-10 pr-12 text-sm shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-navy-2 focus:bg-sheet focus:shadow-md focus:ring-4 focus:ring-navy-2/10" />
        <kbd className="pointer-events-none absolute right-3.5 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-slate-50 px-1.5 font-mono text-[11px] text-slate-400 md:block">/</kbd>
      </label>

      {open && (
        <div id="search-results" role="listbox" className="toast-in absolute left-0 right-0 top-[calc(100%+8px)] z-40 overflow-hidden rounded-xl border border-line bg-sheet shadow-lg">
          {!text && (
            <div className="p-4">
              <div className="eyebrow mb-2 flex items-center gap-1.5"><Sparkles size={12} /> You can ask in plain English</div>
              <div className="flex flex-col items-start gap-1.5">
                {TRY.map((t) => (
                  <button key={t} onClick={() => go(`/cases?nl=${encodeURIComponent(t)}`)}
                    className="rounded-md px-2 py-1 text-left text-sm text-slate-700 hover:bg-slate-100">“{t}”</button>))}
              </div>
              <p className="mt-3 border-t border-line pt-3 text-xs text-slate-500">Or type a case number such as <span className="case-id">RB/2026/00043</span> or part of an institution's name.</p>
            </div>)}

          {text && (
            <ul className="max-h-[60vh] overflow-auto py-1.5">
              {hits.map((h, n) => (
                <li key={h.key + n} role="option" aria-selected={idx === n}>
                  <button onMouseEnter={() => setIdx(n)} onClick={() => go(h.to)}
                    className={cx('flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm', idx === n ? 'bg-slate-100' : 'hover:bg-slate-50')}>
                    {h.kind === 'case' && (<>
                      <FolderOpen size={15} className="shrink-0 text-slate-400" />
                      <span className="case-id w-36 shrink-0 text-navy-2">{h.data.case_id}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-600">{h.data.institution?.name}</span>
                      <BureauBadge code={h.data.bureau} /><span className="hidden sm:block"><StatusChip status={h.data.status} /></span></>)}
                    {h.kind === 'institution' && (<>
                      <Building2 size={15} className="shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{h.data.name}</span>
                      <span className="shrink-0 text-xs text-slate-400">{h.data.city}</span></>)}
                    {(h.kind === 'ask' || h.kind === 'text') && (<>
                      {h.kind === 'ask' ? <Sparkles size={15} className="shrink-0 text-saffron" /> : <Search size={15} className="shrink-0 text-slate-400" />}
                      <span className="flex-1 text-slate-700">{h.kind === 'ask' ? <>Ask: <b className="font-semibold">“{text}”</b></> : <>Search all cases for <b className="font-semibold">“{text}”</b></>}</span>
                      <CornerDownLeft size={14} className="text-slate-300" /></>)}
                  </button>
                </li>))}
            </ul>)}
        </div>)}
    </div>
  )
}
