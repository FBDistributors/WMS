import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { OfflineQueuePage } from '../pages/offline/OfflineQueuePage'
import { PickCompletePage } from '../pages/PickCompletePage'
import { PickDetailsPage } from '../pages/PickDetailsPage'
import { PickItemPage } from '../pages/PickItemPage'
import { PickListPage } from '../pages/PickListPage'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/picking/mobile-pwa" replace />} />
        <Route path="/picking/mobile-pwa" element={<PickListPage />} />
        <Route
          path="/picking/mobile-pwa/:documentId"
          element={<PickDetailsPage />}
        />
        <Route
          path="/picking/mobile-pwa/:documentId/line/:lineId"
          element={<PickItemPage />}
        />
        <Route
          path="/picking/mobile-pwa/:documentId/complete"
          element={<PickCompletePage />}
        />
        <Route path="/offline-queue" element={<OfflineQueuePage />} />
      </Routes>
    </BrowserRouter>
  )
}
