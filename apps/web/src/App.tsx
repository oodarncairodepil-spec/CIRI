import { Routes, Route } from 'react-router-dom'
import { Shell } from './components/layout/Shell'
import { ProjectsPage } from './pages/ProjectsPage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { PagesPage } from './pages/PagesPage'
import { EvidenceViewerPage } from './pages/EvidenceViewerPage'
import { GapReportPage } from './pages/GapReportPage'
import { ExportPage } from './pages/ExportPage'

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
        <Route path="/projects/:id/pages" element={<PagesPage />} />
        <Route path="/projects/:id/pages/:pageId/evidence" element={<EvidenceViewerPage />} />
        <Route path="/projects/:id/gap-report" element={<GapReportPage />} />
        <Route path="/projects/:id/export" element={<ExportPage />} />
      </Route>
    </Routes>
  )
}
