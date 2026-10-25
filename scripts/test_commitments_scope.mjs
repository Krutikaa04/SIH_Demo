import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../frontend/package.json', import.meta.url))
const { createServer } = await import(require.resolve('vite'))
const { createElement } = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { MemoryRouter } = require('react-router-dom')
const apiStub = '\0commitments-scope-api'
const server = await createServer({
  root: fileURLToPath(new URL('../frontend/', import.meta.url)),
  server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
  plugins: [{ name: 'commitments-scope-api', enforce: 'pre',
    resolveId(source, importer) {
      if (source === '../api' && importer?.endsWith('/components/CoordinationCommitments.tsx')) return apiStub
    },
    load(id) {
      if (id === apiStub) return `export const useApi = () => globalThis.__commitmentsScope.response;
        export const useRole = () => globalThis.__commitmentsScope.role;
        export const post = () => { throw Error('Rendering must not write'); };`
    },
  }],
})
try {
  const { default: Commitments } = await server.ssrLoadModule('/src/components/CoordinationCommitments.tsx')
  const data = { room_id: 'ROOM-0001', role: 'SENIOR', scope_region: '', region: 'Western', as_of: '2026-10-25',
    can_create: true, create_disabled_reason: '', cases: [], counts: { open: 0, done: 1, overdue: 0 },
    items: [{ id: 1, case_id: 'PRIVATE/2026/001', case_url: '/cases/PRIVATE%2F2026%2F001',
      title: 'Inspect PRIVATE evidence', owner_bureau: 'PGRC', due_on: '2026-10-26', status: 'DONE',
      overdue: false, can_complete: false, is_room_member: true, current_bureau: 'PGRC',
      completed_by: 'Demo Officer', completed_at: '2026-10-25T10:00:00', completion_note: 'Circular entered in the case record' }] }
  const render = (payload, role = 'SENIOR', region = '', roomId = 'ROOM-0001', error = null) => {
    globalThis.__commitmentsScope = { role: { role, region }, response: { data: payload, loading: false, error, reload() {} } }
    return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Commitments, { roomId })))
  }
  assert.match(render(data), /Demo Officer/)
  assert.match(render(data), /Circular entered/)
  assert.match(render(data), /Add a commitment/)
  assert.doesNotMatch(render(data, 'RB'), /PRIVATE/)
  assert.doesNotMatch(render(data, 'REGIONAL', 'Western'), /PRIVATE/)
  assert.doesNotMatch(render(data, 'SENIOR', '', 'ROOM-0002'), /PRIVATE/)
  const regional = { ...data, role: 'REGIONAL', scope_region: 'Western', can_create: false }
  assert.match(render(regional, 'REGIONAL', 'Western'), /PRIVATE/)
  assert.doesNotMatch(render(regional, 'REGIONAL', 'Western'), /Add a commitment|Record completion/)
  assert.doesNotMatch(render(regional, 'REGIONAL', 'Eastern'), /PRIVATE/)
  assert.doesNotMatch(render(data, 'REGIONAL', ''), /PRIVATE/)
  assert.doesNotMatch(render(data, 'SENIOR', '', 'ROOM-0001', 'Unavailable'), /PRIVATE/)
  process.stdout.write('Commitment room, role, region, completion evidence and read-only controls passed.\n')
} finally {
  delete globalThis.__commitmentsScope
  await server.close()
}
