import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { AdminRoute } from '../components/admin/AdminRoute'
import { DashboardPage } from '../pages/admin/DashboardPage'
import { NotAuthorizedPage } from '../pages/admin/NotAuthorizedPage'
import { ProductDetailsPage } from '../pages/admin/ProductDetailsPage'
import { ProductsListPage } from '../pages/admin/ProductsListPage'
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
        <Route
          path="/admin"
          element={
            <AdminRoute permission="admin:read">
              <DashboardPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/products"
          element={
            <AdminRoute permission="products:read">
              <ProductsListPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/products/:id"
          element={
            <AdminRoute permission="products:read">
              <ProductDetailsPage />
            </AdminRoute>
          }
        />
        <Route path="/admin/not-authorized" element={<NotAuthorizedPage />} />
      </Routes>
    </BrowserRouter>
  )
}
