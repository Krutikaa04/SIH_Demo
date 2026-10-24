import { expect, it, vi } from 'vitest'
import { api, setRole } from '../api'

it.each([
  [{ detail: 'Acknowledgement required' }, 'Acknowledgement required', 'Acknowledgement required'],
  [{ detail: { message: 'Coordinate first', code: 'OVERLAP_ACK_REQUIRED' } }, 'Coordinate first', { message: 'Coordinate first', code: 'OVERLAP_ACK_REQUIRED' }],
])('preserves the status and detail of JSON errors', async (body, message, detail) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 409 })))
  await expect(api('/cases/example/actions')).rejects.toMatchObject({ status: 409, message, detail })
})

it('handles non-JSON errors', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Service unavailable', { status: 503 })))
  await expect(api('/cases')).rejects.toMatchObject({ status: 503, message: 'Service unavailable', detail: null })
})

it('parses successful responses and sends the acting role', async () => {
  setRole({ role: 'PGRC', region: '' })
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await expect(api('/cases')).resolves.toEqual({ items: [] })
  expect(fetchMock).toHaveBeenCalledWith('/api/cases', expect.objectContaining({
    headers: expect.objectContaining({ 'X-Role': 'PGRC' }),
  }))
})
