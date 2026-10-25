import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const frontend = fileURLToPath(new URL('../frontend/', import.meta.url))
const require = createRequire(new URL('../frontend/package.json', import.meta.url))
const { createServer } = await import(require.resolve('vite'))
const { createElement } = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { MemoryRouter } = require('react-router-dom')
const apiStub = '\0aftercare-scope-test-api'
const server = await createServer({
  root: frontend,
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
  plugins: [{
    name: 'aftercare-scope-test-api',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === '../api' && importer?.endsWith('/components/InstitutionAftercare.tsx')) return apiStub
    },
    load(id) {
      if (id === apiStub) return `
        export const useApi = () => globalThis.__aftercareScopeTest.response;
        export const useRole = () => globalThis.__aftercareScopeTest.role;
      `
    },
  }],
})

try {
  const { default: Aftercare } = await server.ssrLoadModule('/src/components/InstitutionAftercare.tsx')
  const report = (role = 'SENIOR', region = '') => ({
    institution_id: '1-1000001', institution: { aicte_id: '1-1000001', region: 'Western' },
    scope: { role, region }, total: 1, summary: { excluded_records: 0 },
    limitation: 'Timing and category do not establish a repeated violation.',
    items: [{ category: 'Faculty Deficiency', elapsed_days: 116,
      current: { case_id: 'PRIVATE/2026/001', bureau: 'RB', received_on: '2026-10-01', url: '/cases/PRIVATE/2026/001' },
      previous: { case_id: 'OLD/2026/001', bureau: 'RB', disposed_on: '2026-06-07', outcome: 'Reply examined',
        url: '/cases/OLD/2026/001', final_action: { seq: 3, actor: 'Officer', remarks: 'File closed', hash: 'abc' } },
    }],
  })
  const render = (data, role = 'SENIOR', region = '', institutionId = '1-1000001', error = null) => {
    globalThis.__aftercareScopeTest = { response: { data, loading: !data, error }, role: { role, region } }
    return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Aftercare, { institutionId })))
  }
  const globalData = report()
  assert.match(render(globalData), /PRIVATE/)
  assert.match(render(globalData), /href="\/cases\/PRIVATE\/2026\/001"/)
  assert.match(render(globalData), /116 calendar days later/)
  assert.doesNotMatch(render(globalData, 'REGIONAL', 'Western'), /PRIVATE/)
  assert.doesNotMatch(render(globalData, 'REGIONAL', ''), /PRIVATE/)
  assert.doesNotMatch(render(globalData, 'REGIONAL', 'Unknown'), /PRIVATE/)
  assert.doesNotMatch(render(globalData, 'RB'), /PRIVATE/)
  assert.doesNotMatch(render(globalData, 'SENIOR', '', '1-2000002'), /PRIVATE/)
  const westernData = report('REGIONAL', 'Western')
  assert.match(render(westernData, 'REGIONAL', 'Western'), /PRIVATE/)
  assert.doesNotMatch(render(westernData, 'REGIONAL', 'Eastern'), /PRIVATE/)
  assert.doesNotMatch(render(westernData, 'SENIOR'), /PRIVATE/)
  assert.match(render(null), /Loading institution aftercare/)
  assert.match(render(null, 'SENIOR', '', '1-1000001', 'Records unavailable'), /Records unavailable/)
  assert.doesNotMatch(render(globalData, 'SENIOR', '', '1-1000001', 'Records unavailable'), /PRIVATE/)
  assert.match(render({ ...globalData, total: 0, items: [] }), /No open complaint has a valid earlier closure/)
  process.stdout.write('Aftercare institution, role, region, source-link and loading/error/empty guards passed.\n')
} finally {
  delete globalThis.__aftercareScopeTest
  await server.close()
}
