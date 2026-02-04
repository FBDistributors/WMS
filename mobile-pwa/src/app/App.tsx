import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { DocumentDetailsPage } from '../pages/picking/DocumentDetailsPage'
import { OfflineQueuePage } from '../pages/offline/OfflineQueuePage'
import { PickListPage } from '../pages/picking/PickListPage'
import { ScanPage } from '../pages/picking/ScanPage'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/picking/mobile-pwa" replace />} />
        <Route path="/picking/mobile-pwa" element={<PickListPage />} />
        <Route
          path="/picking/mobile-pwa/:documentId"
          element={<DocumentDetailsPage />}
        />
        <Route
          path="/picking/mobile-pwa/:documentId/scan"
          element={<ScanPage />}
        />
        <Route path="/offline-queue" element={<OfflineQueuePage />} />
      </Routes>
    </BrowserRouter>
  )
}
