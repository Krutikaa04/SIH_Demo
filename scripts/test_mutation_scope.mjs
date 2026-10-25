import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../frontend/package.json', import.meta.url))
const { createServer } = await import(require.resolve('vite'))
const { createElement } = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { MemoryRouter, Route, Routes } = require('react-router-dom')
const apiStub = '\0mutation-scope-api'
const server = await createServer({
  root: fileURLToPath(new URL('../frontend/', import.meta.url)),
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
  plugins: [{
    name: 'mutation-scope-api', enforce: 'pre',
    resolveId(source, importer) {
      if (source === '../api' && /\/pages\/(CaseDetail|Room|Overlaps)\.tsx$/.test(importer || '')) return apiStub
    },
    load(id) {
      if (id === apiStub) return `
        export const useRole = () => globalThis.__mutationScope.role;
        export const api = async () => { throw new Error('SSR must not mutate'); };
        export const post = api;
        export const download = api;
        export const useApi = (path) => ({ data: path?.startsWith('/rooms/') ? globalThis.__mutationScope.room
          : path?.endsWith('/history') || path?.endsWith('/documents') ? { items: [] }
          : path?.startsWith('/cases/') ? globalThis.__mutationScope.case : null,
          error: null, loading: false, reload() {} });
      `
    },
  }],
})

try {
  const { default: CaseDetail } = await server.ssrLoadModule('/src/pages/CaseDetail.tsx')
  const { default: Room } = await server.ssrLoadModule('/src/pages/Room.tsx')
  const record = {
    case_id: 'RB/2026/PRIVATE', institution: { aicte_id: '1-1', name: 'Private institution', city: 'Pune', region: 'Western' },
    status: 'Received', bureau: 'RB', category: 'Faculty Deficiency', received_on: '2026-10-01', source: 'Letter',
    resolution: { method: 'ID', confidence: 100 }, assigned_officer: { name: 'An officer', designation: 'Case officer' },
    sla: { state: 'OK', days: 30, remaining_days: 20 }, expected_disposal: '2026-10-31', description: 'PRIVATE_CASE_EVIDENCE',
    allowed_actions: ['remark', 'transfer'], escalation_level: 0, transfer_count: 0, overlap: null,
  }
  const room = { id: 'ROOM-PRIVATE', institution: record.institution, lead_bureau: 'RB', cases: [record],
    decision: null, status: 'OPEN', comments: [], pairs: [], timeline: [], can_manage_members: false }
  const render = (url, role = 'SENIOR', region = '', data = record, roomData = room) => {
    globalThis.__mutationScope = { role: { role, region }, case: data, room: roomData }
    return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [url] },
      createElement(Routes, null,
        createElement(Route, { path: '/cases/*', element: createElement(CaseDetail) }),
        createElement(Route, { path: '/rooms/:id', element: createElement(Room) }))))
  }
  assert.match(render('/cases/RB/2026/PRIVATE'), /PRIVATE_CASE_EVIDENCE/)
  assert.doesNotMatch(render('/cases/RB/2026/NEW'), /PRIVATE_CASE_EVIDENCE|Write a note|Transfer the case/)
  assert.doesNotMatch(render('/cases/RB/2026/PRIVATE', 'REGIONAL', 'Northern'), /PRIVATE_CASE_EVIDENCE/)
  assert.doesNotMatch(render('/cases/RB/2026/PRIVATE', 'REGIONAL', ''), /PRIVATE_CASE_EVIDENCE/)
  assert.match(render('/rooms/ROOM-PRIVATE'), /ROOM-PRIVATE/)
  assert.doesNotMatch(render('/rooms/ROOM-NEW'), /ROOM-PRIVATE|Record the decision/)
  assert.doesNotMatch(render('/rooms/ROOM-PRIVATE', 'REGIONAL', 'Northern'), /ROOM-PRIVATE|Record the decision/)
  assert.doesNotMatch(render('/rooms/ROOM-PRIVATE', 'REGIONAL', ''), /ROOM-PRIVATE|Record the decision/)
  assert.match(render('/rooms/ROOM-PRIVATE', 'REGIONAL', 'Western'), /ROOM-PRIVATE/)
  process.stdout.write('Mutation views reject retained records from other route IDs and regions.\n')
} finally {
  delete globalThis.__mutationScope
  await server.close()
}
