import { render, screen } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import { CrawlProgress } from '@/components/crawl/CrawlProgress'
import type { CrawlJob } from '@/api/types'

const runningJob: CrawlJob = {
  id: 'j1',
  projectId: 'p1',
  status: 'running',
  pagesDiscovered: 100,
  pagesCaptured: 42,
  pagesFailed: 3,
  createdAt: new Date().toISOString(),
}

describe('CrawlProgress', () => {
  test('displays discovered, captured and failed counts', () => {
    render(<CrawlProgress job={runningJob} />)
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  test('shows progress bar at correct percentage', () => {
    render(<CrawlProgress job={runningJob} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
  })

  test('does not invoke refetch when status is completed', () => {
    const refetch = vi.fn()
    render(<CrawlProgress job={{ ...runningJob, status: 'completed' }} refetch={refetch} />)
    expect(refetch).not.toHaveBeenCalled()
  })

  test('clamps progress bar to 0 when no pages discovered', () => {
    render(<CrawlProgress job={{ ...runningJob, pagesDiscovered: 0, pagesCaptured: 0 }} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '0')
  })
})
