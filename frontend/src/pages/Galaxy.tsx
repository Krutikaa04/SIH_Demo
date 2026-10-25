import { useState, useCallback, useMemo } from 'react'
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Panel,
  MarkerType,
  Handle,
  Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useNavigate } from 'react-router-dom'
import { Share2, ZoomIn, Building2, FolderOpen, Shield, Users, ArrowRight, X, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useApi } from '../api'
import { Card, Loading, ErrorBox, cx } from '../ui'

// Custom Institution Node
function InstitutionNode({ data }: { data: any }) {
  return (
    <div className={cx(
      'rounded-xl border-2 bg-sheet px-3.5 py-2.5 shadow-md transition-all hover:shadow-lg',
      data.hasCluster ? 'border-amber-400 ring-2 ring-amber-400/20' : 'border-slate-300'
    )} style={{ minWidth: 170 }}>
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <div className="flex items-center gap-2">
        <div className={cx('grid h-7 w-7 place-items-center rounded-lg text-white', data.hasCluster ? 'bg-amber-500' : 'bg-slate-700')}>
          <Building2 size={14} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-bold text-slate-900">{data.label}</div>
          <div className="text-[9.5px] text-slate-500">{data.city || data.region} · {data.caseCount} cases</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  )
}

// Custom Case Node
function CaseNode({ data }: { data: any }) {
  const isBreached = data.isOverdue
  return (
    <div className={cx(
      'rounded-lg border bg-sheet px-2.5 py-1.5 shadow-sm transition hover:scale-105',
      isBreached ? 'border-red-400 ring-1 ring-red-400/30' : 'border-slate-200'
    )} style={{ minWidth: 120 }}>
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <div className="flex items-center justify-between gap-1.5">
        <span className="font-mono text-[10px] font-semibold text-slate-800">{data.label}</span>
        <span className="rounded px-1 text-[8.5px] font-bold text-white" style={{ background: data.bureauColor || '#3b82f6' }}>
          {data.bureau}
        </span>
      </div>
      <div className="mt-0.5 truncate text-[9px] text-slate-500">{data.category}</div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  )
}

// Custom Bureau Node
function BureauNode({ data }: { data: any }) {
  return (
    <div className="rounded-xl border border-white/20 px-3.5 py-2 text-white shadow-lg"
      style={{ background: data.color || '#1e293b', minWidth: 110 }}>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <div className="flex items-center gap-2">
        <Shield size={14} />
        <span className="text-xs font-bold">{data.code} Bureau</span>
      </div>
    </div>
  )
}

// Custom Cluster / Taskforce Node
function ClusterNode({ data }: { data: any }) {
  return (
    <div className="rounded-xl border-2 border-amber-500 bg-amber-50 px-3 py-2 text-amber-900 shadow-md">
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <div className="flex items-center gap-1.5 text-xs font-bold">
        <Users size={14} className="text-amber-600" />
        <span>{data.label}</span>
      </div>
      <div className="mt-0.5 text-[9.5px] text-amber-700">Lead: {data.leadBureau || 'Joint'}</div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  )
}

const nodeTypes = {
  institutionNode: InstitutionNode,
  caseNode: CaseNode,
  bureauNode: BureauNode,
  clusterNode: ClusterNode,
}

export default function Galaxy() {
  const nav = useNavigate()

const [bureau, setBureau] = useState<string>('')
const [region, setRegion] = useState<string>('')
const [institutionId, setInstitutionId] = useState<string>('')
const [clusterOnly, setClusterOnly] = useState(false)
const [selectedEntity, setSelectedEntity] = useState<any>(null)

const qs = useMemo(() => {
  const params = new URLSearchParams()
  if (bureau) params.set('bureau', bureau)
  if (region) params.set('region', region)
  if (institutionId) params.set('institution_id', institutionId)
  if (clusterOnly) params.set('cluster_only', 'true')

  const query = params.toString()
  return query ? `?${query}` : ''
}, [bureau, region, institutionId, clusterOnly])

const { data: graphData, loading, error } = useApi<any>(
  `/galaxy/graph${qs}`
)


  const nodes = useMemo(() => graphData?.nodes || [], [graphData])
  const edges = useMemo(() => graphData?.edges || [], [graphData])

  const onNodeClick = useCallback((_: any, node: any) => {
    setSelectedEntity({ type: 'node', ...node.data })
  }, [])

  const onEdgeClick = useCallback((_: any, edge: any) => {
    setSelectedEntity({ type: 'edge', ...edge.data, id: edge.id })
  }, [])

  return (
    <div className="flex h-[calc(100vh-11rem)] min-h-[480px] flex-col gap-3 md:h-[calc(100vh-9rem)]">
      {/* Top Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-sheet px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-navy text-white">
            <Share2 size={16} />
          </div>
          <div>
            <h1 className="font-display text-[1.125rem] font-semibold text-slate-900">Connection map</h1>
            <p className="text-[12px] text-slate-500">How institutions, Bureaus and overlapping cases connect. Drag to move, scroll to zoom, select anything for details.</p>
          </div>
        </div>

        {/* Bureau Filters */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] font-medium text-slate-500 mr-1">Show Bureau:</span>
          {['', 'RB', 'PGRC', 'AB', 'LC', 'VIG'].map((b) => (
            <button
              key={b}
              onClick={() => setBureau(b)}
              className={cx(
                'rounded-full px-2.5 py-1 text-xs font-semibold transition',
                bureau === b ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              )}>
              {b || 'All'}
            </button>
          ))}
        </div>

{/* Additional Galaxy Filters */}
<div className="flex flex-wrap items-center gap-3">
  <select
    value={region}
    onChange={(e) => {
      setRegion(e.target.value)
      setInstitutionId('')
    }}
    aria-label="Filter by region"
    className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200"
  >
    <option value="">All Regions</option>
    {(graphData?.filterOptions?.regions || []).map((value: string) => (
      <option key={value} value={value}>
        {value}
      </option>
    ))}
  </select>

  <select
    value={institutionId}
    onChange={(e) => setInstitutionId(e.target.value)}
    aria-label="Filter by institution"
    className="max-w-64 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200"
  >
    <option value="">All Institutions</option>
    {(graphData?.filterOptions?.institutions || [])
      .filter((inst: any) => !region || inst.region?.toLowerCase() === region.toLowerCase())
      .map((inst: any) => (
        <option key={inst.id} value={inst.id}>
          {inst.label}
        </option>
      ))}
  </select>

  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
    <input
      type="checkbox"
      checked={clusterOnly}
      onChange={(e) => setClusterOnly(e.target.checked)}
      className="accent-cyan-500"
    />
    Clustered cases only
  </label>
</div>

        {/* Legend */}
        <div className="hidden lg:flex items-center gap-3 text-[11px] text-slate-600">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-cyan-500" /> Confirmed link
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-purple-500" /> Strong overlap
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-500" /> Coordination room
          </span>
        </div>
      </div>

{graphData?.truncated && (
  <div
    role="status"
    className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
  >
    <AlertTriangle size={16} />
    <span>
      Showing {graphData.shownCases} of {graphData.totalCases} cases — narrow with filters.
    </span>
  </div>
)}

      {/* Canvas Area */}
      <div className="relative flex-1 overflow-hidden rounded-xl border border-slate-200 bg-slate-950 shadow-inner">
        {loading && !graphData ? (
          <div className="flex h-full items-center justify-center">
            <Loading />
          </div>
        ) : error ? (
          <div className="p-6">
            <ErrorBox msg={error} />
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.2}
            maxZoom={2.5}
            defaultEdgeOptions={{ animated: true }}>
            <Background color="#334155" gap={24} size={1} />
            <Controls className="!bg-sheet !border-slate-200 !shadow-lg" />
            <MiniMap
              className="!bg-slate-900 !border-slate-800"
              nodeColor={(n) => {
                if (n.type === 'institutionNode') return '#3b82f6'
                if (n.type === 'clusterNode') return '#f59e0b'
                if (n.type === 'bureauNode') return '#8b5cf6'
                return '#94a3b8'
              }}
            />
          </ReactFlow>
        )}

        {/* Right-Side Inspector Drawer */}
        {selectedEntity && (
          <div className="absolute right-3 top-3 bottom-3 z-20 w-80 overflow-auto rounded-xl border border-slate-700 bg-slate-900/95 p-4 text-white shadow-2xl backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Inspector</span>
              <button onClick={() => setSelectedEntity(null)} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white">
                <X size={15} />
              </button>
            </div>

            <div className="mt-3 space-y-3">
              {selectedEntity.type === 'node' && (
                <>
                  <div>
                    <span className="rounded bg-navy-2/60 px-1.5 py-0.5 text-[10px] font-bold uppercase text-cyan-400">
                      {selectedEntity.entityType}
                    </span>
                    <h3 className="mt-1 text-sm font-bold text-white">{selectedEntity.label}</h3>
                  </div>

                  {selectedEntity.entityType === 'case' && (
                    <div className="space-y-2 text-xs text-slate-300">
                      <div><span className="text-slate-400">Bureau:</span> <span className="font-semibold">{selectedEntity.bureau}</span></div>
                      <div><span className="text-slate-400">Category:</span> {selectedEntity.category}</div>
                      <div><span className="text-slate-400">Institution:</span> {selectedEntity.institutionName}</div>
                      {selectedEntity.isOverdue && (
                        <div className="flex items-center gap-1.5 font-bold text-red-400">
                          <AlertTriangle size={14} /> Statutory SLA Breached
                        </div>
                      )}
                      <button
                        onClick={() => nav(`/cases/${selectedEntity.id}`)}
                        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-navy py-2 text-xs font-semibold text-white hover:bg-navy-2">
                        Open Case Dossier <ArrowRight size={13} />
                      </button>
                    </div>
                  )}

                  {selectedEntity.entityType === 'institution' && (
                    <div className="space-y-2 text-xs text-slate-300">
                      <div><span className="text-slate-400">Location:</span> {selectedEntity.city}, {selectedEntity.region}</div>
                      <div><span className="text-slate-400">Dockets:</span> {selectedEntity.caseCount} complaints</div>
                      <button
                        onClick={() => nav(`/institutions/${selectedEntity.id}`)}
                        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-navy py-2 text-xs font-semibold text-white hover:bg-navy-2">
                        View Institution Profile <ArrowRight size={13} />
                      </button>
                    </div>
                  )}

                  {selectedEntity.entityType === 'cluster' && (
                    <div className="space-y-2 text-xs text-slate-300">
                      <div><span className="text-slate-400">Taskforce ID:</span> {selectedEntity.id}</div>
                      <div><span className="text-slate-400">Lead Bureau:</span> {selectedEntity.leadBureau}</div>
                      {selectedEntity.roomId && (
                        <button
                          onClick={() => nav(`/rooms/${selectedEntity.roomId}`)}
                          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-600 py-2 text-xs font-semibold text-white hover:bg-amber-500">
                          Open Coordination Room <ArrowRight size={13} />
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}

              {selectedEntity.type === 'edge' && (
                <div className="space-y-2 text-xs text-slate-300">
                  <div className="text-xs font-bold text-white">{selectedEntity.headline}</div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">Confidence Score:</span>
                    <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-xs font-bold text-cyan-300">
                      {selectedEntity.score}%
                    </span>
                  </div>
                  <div><span className="text-slate-400">Band:</span> {selectedEntity.band}</div>
                  <button
                    onClick={() => nav(`/overlaps`)}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-navy py-2 text-xs font-semibold text-white hover:bg-navy-2">
                    Review in Overlaps Queue <ArrowRight size={13} />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
