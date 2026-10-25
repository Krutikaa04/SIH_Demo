import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const frontend = fileURLToPath(new URL('../frontend/', import.meta.url))
const require = createRequire(new URL('../frontend/package.json', import.meta.url))
const { createServer } = await import(require.resolve('vite'))
const { createElement } = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { MemoryRouter } = require('react-router-dom')
const apiStub = '\0briefing-scope-test-api'
const server = await createServer({
  root: frontend,
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
  plugins: [{
    name: 'briefing-scope-test-api',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === '../api' && importer?.endsWith('/pages/Briefings.tsx')) return apiStub
    },
    load(id) {
      if (id === apiStub) return `
        export const useApi = () => globalThis.__briefingScopeTest.response;
        export const useRole = () => globalThis.__briefingScopeTest.role;
      `
    },
  }],
})

try {
  const { default: Briefings } = await server.ssrLoadModule('/src/pages/Briefings.tsx')
  const briefing = (region) => ({
    generated_at: 'October 25, 2026', scope: region ? `${region} region` : 'All regions', region,
    total_cases: 1, pending_cases: 1, overdue_cases: 0, active_rooms: 0, action_agenda: [], agenda_method: '',
    sections: [{ id: 'overview', title: 'Stored evidence', badge: '', content: '[PRIVATE/2026/0042]' }],
    citations: { '[PRIVATE/2026/0042]': '/cases/PRIVATE%2F2026%2F0042' },
  })
  const render = (data, role, region, error = null) => {
    globalThis.__briefingScopeTest = { response: { data, loading: false, error }, role: { role, region } }
    return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Briefings)))
  }
  const globalData = briefing('')
  assert.match(render(globalData, 'SENIOR', ''), /PRIVATE/)
  assert.doesNotMatch(render(globalData, 'REGIONAL', 'Western'), /PRIVATE/)
  assert.doesNotMatch(render(globalData, 'REGIONAL', ''), /PRIVATE/)
  assert.doesNotMatch(render(globalData, 'REGIONAL', 'Unknown'), /PRIVATE/)
  const westernData = briefing('Western')
  assert.match(render(westernData, 'REGIONAL', 'Western'), /PRIVATE/)
  assert.doesNotMatch(render(westernData, 'REGIONAL', 'Eastern'), /PRIVATE/)
  assert.doesNotMatch(render(westernData, 'SENIOR', ''), /PRIVATE/)
  assert.match(render(globalData, 'REGIONAL', '', 'A recognized region is required'), /recognized region/)
  assert.doesNotMatch(render(globalData, 'REGIONAL', '', 'A recognized region is required'), /PRIVATE/)
  process.stdout.write('Briefing scope transitions passed (global, regional, invalid and error states).\n')
} finally {
  delete globalThis.__briefingScopeTest
  await server.close()
}
