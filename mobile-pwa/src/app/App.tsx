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
import { BrandsPage } from '../pages/admin/BrandsPage'
import { OrdersPage } from '../pages/admin/OrdersPage'
import { OrderDetailsPage } from '../pages/admin/OrderDetailsPage'
import { LocationsPage } from '../pages/admin/LocationsPage'
import { LocationDetailPage } from '../pages/admin/LocationDetailPage'
import { ReceivingPage } from '../pages/admin/ReceivingPage'
import { InventorySummaryPage } from '../pages/admin/InventorySummaryPage'
import { InventoryDetailsPage } from '../pages/admin/InventoryDetailsPage'
import { InventoryMovementsPage } from '../pages/admin/InventoryMovementsPage'
import { UsersPage } from '../pages/admin/UsersPage'
import { UserCreatePage } from '../pages/admin/users/UserCreatePage'
import { UserDetailsPage } from '../pages/admin/users/UserDetailsPage'
import { AuditLogsPage } from '../pages/admin/AuditLogsPage'
import { PickListsPage } from '../pages/admin/PickListsPage'
import { OfflineQueuePage } from '../pages/offline/OfflineQueuePage'
import { PickCompletePage } from '../pages/PickCompletePage'
import { PickDetailsPage } from '../pages/PickDetailsPage'
import { PickItemPage } from '../pages/PickItemPage'
import { PickListPage } from '../pages/PickListPage'
import { PickerLayout } from '../components/picker/PickerLayout'
import { ControllerLayout } from '../components/controller/ControllerLayout'
import { PickerHomePage } from '../pages/picker/PickerHomePage'
import { PickerInventoryPage } from '../pages/picker/PickerInventoryPage'
import { PickerInventoryDetailPage } from '../pages/picker/PickerInventoryDetailPage'
import { PickerSettingsPage } from '../pages/picker/PickerSettingsPage'
import { PickerProfilePage } from '../pages/picker/PickerProfilePage'
import { ControllerHomePage } from '../pages/controller/ControllerHomePage'
import { ControllerDocumentsPage } from '../pages/controller/ControllerDocumentsPage'
import { ControllerProductsPage } from '../pages/controller/ControllerProductsPage'
import { ControllerProductDetailPage } from '../pages/controller/ControllerProductDetailPage'
import { ControllerSettingsPage } from '../pages/controller/ControllerSettingsPage'
import { ControllerProfilePage } from '../pages/controller/ControllerProfilePage'
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
          path="/picker"
          element={
            <RequireRoleOrPermission permissions={['picking:read', 'inventory:read']}>
              <PickerLayout>
                <PickerHomePage />
              </PickerLayout>
            </RequireRoleOrPermission>
          }
        />
        <Route
          path="/picking/mobile-pwa"
          element={
            <RequireRoleOrPermission permission="picking:read">
              <PickerLayout>
                <PickListPage />
              </PickerLayout>
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
          path="/picker/inventory"
          element={
            <RequireRoleOrPermission permissions={['picking:read', 'inventory:read']}>
              <PickerLayout>
                <PickerInventoryPage />
              </PickerLayout>
            </RequireRoleOrPermission>
          }
        />
        <Route
          path="/picker/inventory/:productId"
          element={
            <RequireRoleOrPermission permissions={['picking:read', 'inventory:read']}>
              <PickerLayout>
                <PickerInventoryDetailPage />
              </PickerLayout>
            </RequireRoleOrPermission>
          }
        />
        <Route
          path="/picker/profile"
          element={
            <RequireRoleOrPermission permissions={['picking:read', 'inventory:read']}>
              <PickerLayout>
                <PickerProfilePage />
              </PickerLayout>
            </RequireRoleOrPermission>
          }
        />
        <Route
          path="/picker/settings"
          element={
            <RequireRoleOrPermission permissions={['picking:read', 'inventory:read']}>
              <PickerLayout>
                <PickerSettingsPage />
              </PickerLayout>
            </RequireRoleOrPermission>
          }
        />
        {/* Controller profile (inventory_controller) */}
        <Route
          path="/controller"
          element={
            <RequireRoleOrPermission permissions={['documents:read', 'products:read']}>
              <ControllerLayout>
                <ControllerHomePage />
              </ControllerLayout>
            </RequireRoleOrPermission>
          }
        />
        <Route
          path="/controller/documents"
          element={
            <RequireRoleOrPermission permissions={['documents:read', 'products:read']}>
              <ControllerLayout>
                <ControllerDocumentsPage />
              </ControllerLayout>
            </RequireRoleOrPermission>
          }
        />
        <Route
          path="/controller/products"
          element={
            <RequireRoleOrPermission permissions={['documents:read', 'products:read']}>
              <ControllerLayout>
                <ControllerProductsPage />
              </ControllerLayout>
            </RequireRoleOrPermission>
          }
        />
        <Route
          path="/controller/products/:productId"
          element={
            <RequireRoleOrPermission permissions={['documents:read', 'products:read']}>
              <ControllerLayout>
                <ControllerProductDetailPage />
              </ControllerLayout>
            </RequireRoleOrPermission>
          }
        />
        <Route
          path="/controller/profile"
          element={
            <RequireRoleOrPermission permissions={['documents:read', 'products:read']}>
              <ControllerLayout>
                <ControllerProfilePage />
              </ControllerLayout>
            </RequireRoleOrPermission>
          }
        />
        <Route
          path="/controller/settings"
          element={
            <RequireRoleOrPermission permissions={['documents:read', 'products:read']}>
              <ControllerLayout>
                <ControllerSettingsPage />
              </ControllerLayout>
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
          path="/admin/brands"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="brands:manage">
                <BrandsPage />
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
          path="/admin/order-statuses"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="orders:read">
                <OrdersPage mode="statuses" />
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
          path="/admin/picking"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="picking:read">
                <PickListsPage />
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
          path="/admin/locations/:id"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="inventory:read">
                <LocationDetailPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/inventory"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="inventory:read">
                <InventorySummaryPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/inventory/movements"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="movements:read">
                <InventoryMovementsPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/inventory/:productId"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="inventory:read">
                <InventoryDetailsPage />
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
          path="/admin/audit"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="audit:read">
                <AuditLogsPage />
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
