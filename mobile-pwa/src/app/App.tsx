import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { RequirePermission } from '../rbac/RequirePermission'
import { RequireAuth } from '../rbac/RequireAuth'
import { RequireRoleOrPermission } from '../rbac/RequireRoleOrPermission'
import { useAuth } from '../rbac/AuthProvider'
import { getHomeRouteForRole } from '../rbac/routes'
import { DashboardPage } from '../pages/admin/DashboardPage'
import { NotAuthorizedPage } from '../pages/admin/NotAuthorizedPage'
import { ProfilePage } from '../pages/admin/ProfilePage'
import { ProductDetailsPage } from '../pages/admin/ProductDetailsPage'
import { ProductsPage } from '../pages/admin/ProductsPage'
import { OrdersPage } from '../pages/admin/OrdersPage'
import { OrderDetailsPage } from '../pages/admin/OrderDetailsPage'
import { LocationsPage } from '../pages/admin/LocationsPage'
import { ReceivingPage } from '../pages/admin/ReceivingPage'
import { UsersPage } from '../pages/admin/UsersPage'
import { UserCreatePage } from '../pages/admin/users/UserCreatePage'
import { UserDetailsPage } from '../pages/admin/users/UserDetailsPage'
import { OfflineQueuePage } from '../pages/offline/OfflineQueuePage'
import { PickCompletePage } from '../pages/PickCompletePage'
import { PickDetailsPage } from '../pages/PickDetailsPage'
import { PickItemPage } from '../pages/PickItemPage'
import { PickListPage } from '../pages/PickListPage'
import { LoginPage } from '../pages/LoginPage'
import { NotAuthorizedPage as AppNotAuthorizedPage } from '../pages/NotAuthorizedPage'

function SmartRedirect() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return null
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <Navigate to={getHomeRouteForRole(user.role)} replace />
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SmartRedirect />} />
        <Route
          path="/picking/mobile-pwa"
          element={
            <RequireRoleOrPermission permission="picking:read">
              <PickListPage />
            </RequireRoleOrPermission>
          }
        />
        <Route
          path="/picking/mobile-pwa/:documentId"
          element={
            <RequireRoleOrPermission permission="picking:read">
              <PickDetailsPage />
            </RequireRoleOrPermission>
          }
        />
        <Route
          path="/picking/mobile-pwa/:documentId/line/:lineId"
          element={
            <RequireRoleOrPermission permission="picking:read">
              <PickItemPage />
            </RequireRoleOrPermission>
          }
        />
        <Route
          path="/picking/mobile-pwa/:documentId/complete"
          element={
            <RequireRoleOrPermission permission="picking:read">
              <PickCompletePage />
            </RequireRoleOrPermission>
          }
        />
        <Route
          path="/offline-queue"
          element={
            <RequireAuth>
              <OfflineQueuePage />
            </RequireAuth>
          }
        />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/admin"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <DashboardPage />
            </RequirePermission>
          }
        />
        <Route
          path="/admin/products"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="products:read">
                <ProductsPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/products/:id"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="products:read">
                <ProductDetailsPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/orders"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="orders:read">
                <OrdersPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/orders/:id"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="orders:read">
                <OrderDetailsPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/locations"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="locations:manage">
                <LocationsPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/receiving"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="receiving:read">
                <ReceivingPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="users:manage">
                <UsersPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/users/new"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="users:manage">
                <UserCreatePage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/users/:id"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="users:manage">
                <UserDetailsPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/profile"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <ProfilePage />
            </RequirePermission>
          }
        />
        <Route
          path="/admin/not-authorized"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <NotAuthorizedPage />
            </RequirePermission>
          }
        />
        <Route path="/not-authorized" element={<AppNotAuthorizedPage />} />
      </Routes>
    </BrowserRouter>
  )
}
