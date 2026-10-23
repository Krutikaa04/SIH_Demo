import { useMemo, useState } from 'react'
import { geoMercator, geoPath } from 'd3-geo'
import geo from '../assets/india-regions.json'
import { cx } from '../ui'

type Region = { region: string; total: number; pending: number; overdue: number; avg_risk: number }
const METRICS: Record<string, { label: string; get: (r: Region) => number; from: string; to: string }> = {
  pending: { label: 'Pending', get: (r) => r.pending, from: '#dbeafe', to: '#1e3a8a' },
  overdue: { label: 'Beyond timeline', get: (r) => r.overdue, from: '#fee2e2', to: '#7f1d1d' },
  risk: { label: 'Avg risk', get: (r) => r.avg_risk, from: '#fef3c7', to: '#b91c1c' },
}
const W = 420, H = 470

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mix = (a: string, b: string, t: number) => {
  const [x, y] = [hex(a), hex(b)]
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`
}

export default function IndiaMap({ regions, onSelect }: { regions: Region[]; onSelect: (r: string) => void }) {
  const [metric, setMetric] = useState<'pending' | 'overdue' | 'risk'>('pending')
  const [hover, setHover] = useState<string | null>(null)
  const m = METRICS[metric]
  const paths = useMemo(() => {
    const proj = geoMercator().fitSize([W, H], geo as any)
    const path = geoPath(proj)
    return (geo as any).features.map((f: any) => ({ d: path(f) || '', region: f.properties.region, state: f.properties.state }))
  }, [])
  const byRegion = Object.fromEntries(regions.map((r) => [r.region, r]))
  const vals = regions.map(m.get)
  const max = Math.max(...vals, 1), min = Math.min(...vals, 0)
  const color = (region: string) => {
    const r = byRegion[region]
    if (!r) return '#e5e7eb'
    return mix(m.from, m.to, max === min ? 0.6 : 0.12 + 0.88 * (m.get(r) - min) / (max - min))
  }
  const h = hover ? byRegion[hover] : null

  return (
    <div>
      <div className="mb-2 flex rounded-lg bg-slate-100 p-1 text-xs">
        {Object.entries(METRICS).map(([k, v]) => (
          <button key={k} onClick={() => setMetric(k as any)}
            className={cx('flex-1 rounded-md px-2 py-1 font-medium transition', metric === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>{v.label}</button>))}
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full max-w-[420px]" onMouseLeave={() => setHover(null)}>
          {paths.map((p: any, i: number) => (
            <path key={i} d={p.d} fill={color(p.region)} stroke="#fff" strokeWidth={hover === p.region ? 1.6 : 0.7}
              opacity={hover && hover !== p.region ? 0.55 : 1} className="cursor-pointer transition-opacity"
              onMouseEnter={() => setHover(p.region)} onClick={() => byRegion[p.region] && onSelect(p.region)}>
              <title>{p.state} — {p.region} region</title>
            </path>))}
        </svg>
        {h && (
          <div className="pointer-events-none absolute left-1 top-1 rounded-lg bg-slate-900/92 px-3 py-2 text-xs text-white shadow-lg">
            <div className="mb-1 text-sm font-semibold">{h.region}</div>
            <div className="num space-y-0.5 text-slate-200">
              <div>Pending: <b className="text-white">{h.pending}</b> of {h.total}</div>
              <div>Beyond timeline: <b className="text-red-300">{h.overdue}</b></div>
              <div>Avg institution risk: <b className="text-amber-300">{h.avg_risk}</b></div>
            </div>
            <div className="mt-1 text-[10px] text-slate-400">Click to open cases</div>
          </div>)}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
        <span className="num">{Math.round(min)}</span>
        <span className="h-2 flex-1 rounded-full" style={{ background: `linear-gradient(90deg, ${m.from}, ${m.to})` }} />
        <span className="num">{Math.round(max)}</span>
        <span className="ml-1">{m.label}</span>
      </div>
    </div>
  )
}
