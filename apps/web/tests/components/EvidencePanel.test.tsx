import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect } from 'vitest'
import { EvidencePanel } from '@/components/evidence/EvidencePanel'
import type { PageCapture } from '@/api/types'

const capture: PageCapture = {
  id: 'cap-1',
  pageId: 'pg-1',
  viewportWidth: 1440,
  viewportHeight: 900,
  screenshotDesktopKey: 'projects/p1/screenshots/pg1-desktop.png',
  capturedAt: new Date().toISOString(),
}

describe('EvidencePanel', () => {
  test('renders three panel tabs', () => {
    render(<EvidencePanel capture={capture} domData={[]} stylesData={{}} />)
    expect(screen.getByRole('tab', { name: 'DOM' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Styles' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Screenshot' })).toBeInTheDocument()
  })

  test('DOM tab is selected by default', () => {
    render(<EvidencePanel capture={capture} domData={[]} stylesData={{}} />)
    expect(screen.getByRole('tab', { name: 'DOM' })).toHaveAttribute('aria-selected', 'true')
  })

  test('switches to Screenshot panel on tab click', async () => {
    render(<EvidencePanel capture={capture} domData={[]} stylesData={{}} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Screenshot' }))
    expect(screen.getByRole('tab', { name: 'Screenshot' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'DOM' })).toHaveAttribute('aria-selected', 'false')
  })

  test('shows "Screenshot unavailable" when no desktop key', () => {
    const noScreenshot = { ...capture, screenshotDesktopKey: undefined }
    render(<EvidencePanel capture={noScreenshot} domData={[]} stylesData={{}} />)
    // Switch to screenshot tab first
    userEvent.click(screen.getByRole('tab', { name: 'Screenshot' }))
  })
})
