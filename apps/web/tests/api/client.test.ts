import { describe, test, expect, vi, beforeEach } from 'vitest'
import { apiClient } from '@/api/client'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('apiClient.createProject', () => {
  test('POSTs to /api/projects and returns the created project', async () => {
    const mockProject = { id: 'proj-1', name: 'Test', url: 'https://example.com', status: 'created', createdAt: '', updatedAt: '' }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockProject,
    } as Response)

    const result = await apiClient.createProject({ name: 'Test', url: 'https://example.com' })

    expect(result.id).toBe('proj-1')
    const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/projects')
    expect(options.method).toBe('POST')
  })

  test('throws an error with the API error message on non-2xx response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid URL' }),
    } as Response)

    await expect(apiClient.createProject({ name: 'X', url: 'not-a-url' })).rejects.toThrow('Invalid URL')
  })
})

describe('apiClient.listProjects', () => {
  test('GETs /api/projects and returns array', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'p1', name: 'A', url: 'https://a.com', status: 'created', createdAt: '', updatedAt: '' }],
    } as Response)

    const result = await apiClient.listProjects()
    expect(Array.isArray(result)).toBe(true)
    expect(result[0].id).toBe('p1')
  })
})

describe('apiClient.getBlueprintDownloadUrl', () => {
  test('returns the API path string without fetching', () => {
    const url = apiClient.getBlueprintDownloadUrl('bp-123')
    expect(url).toBe('/api/blueprints/bp-123/download')
  })
})
