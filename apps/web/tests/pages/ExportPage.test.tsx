import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { ExportPage } from '@/pages/ExportPage'
import * as clientModule from '@/api/client'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof clientModule>()
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      getBlueprint: vi.fn(),
      getMcpConfig: vi.fn(),
      getBlueprintDownloadUrl: vi.fn(),
    },
  }
})

const readyBlueprint = {
  id: 'bp-1',
  projectId: 'p1',
  version: 1,
  zipSize: 204800,
  status: 'ready' as const,
  createdAt: new Date().toISOString(),
}
const mcpConfig = { mcpServerUrl: 'http://localhost:3000/mcp/p1', projectId: 'p1' }

function setup() {
  vi.mocked(clientModule.apiClient.getBlueprint).mockResolvedValue(readyBlueprint)
  vi.mocked(clientModule.apiClient.getMcpConfig).mockResolvedValue(mcpConfig)
  vi.mocked(clientModule.apiClient.getBlueprintDownloadUrl).mockReturnValue('/api/blueprints/bp-1/download')

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/projects/p1/export']}>
        <Routes>
          <Route path="/projects/:id/export" element={<ExportPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('ExportPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  test('shows download link pointing at API endpoint with download attribute', async () => {
    setup()
    const link = await screen.findByRole('link', { name: /download blueprint/i })
    expect(link).toHaveAttribute('href', '/api/blueprints/bp-1/download')
    expect(link).toHaveAttribute('download')
  })

  test('shows formatted ZIP size in KB', async () => {
    setup()
    await screen.findByText('200 KB')
  })

  test('copy button puts MCP config JSON on clipboard', async () => {
    setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await userEvent.click(await screen.findByRole('button', { name: /copy mcp config/i }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('mcpServerUrl'))
  })
})
