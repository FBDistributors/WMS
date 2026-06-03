import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from 'react-router-dom'

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
import { AdminSettingsPage } from '../pages/admin/AdminSettingsPage'
import { OrdersPage } from '../pages/admin/OrdersPage'
import { OrikzorHarakatlariPage } from '../pages/admin/OrikzorHarakatlariPage'
import { MovementDetailsPage } from '../pages/admin/MovementDetailsPage'
import { OrderDetailsPage } from '../pages/admin/OrderDetailsPage'
import { LocationsPage } from '../pages/admin/LocationsPage'
import { LocationDetailPage } from '../pages/admin/LocationDetailPage'
import { ReceivingPage } from '../pages/admin/ReceivingPage'
import { InventorySummaryPage } from '../pages/admin/InventorySummaryPage'
import { SmartupBalancePage } from '../pages/admin/SmartupBalancePage'
import { SmartupBronPage } from '../pages/admin/SmartupBronPage'
import { SmartupCustomPage } from '../pages/admin/SmartupCustomPage'
import { InventoryReserveHealthPage } from '../pages/admin/InventoryReserveHealthPage'
import { InventoryReserveHistoryPage } from '../pages/admin/InventoryReserveHistoryPage'
import { InventoryDetailsPage } from '../pages/admin/InventoryDetailsPage'
import { MovementPage } from '../pages/admin/MovementPage'
import { UsersPage } from '../pages/admin/UsersPage'
import { UserCreatePage } from '../pages/admin/users/UserCreatePage'
import { UserDetailsPage } from '../pages/admin/users/UserDetailsPage'
import { AuditLogsPage } from '../pages/admin/AuditLogsPage'
import { KamomatlarPage } from '../pages/admin/KamomatlarPage'
import { ReturnsHistoryPage } from '../pages/admin/ReturnsHistoryPage'
import { ReturnDetailsPage } from '../pages/admin/ReturnDetailsPage'
import { MahsulotYoqQilishPage } from '../pages/admin/MahsulotYoqQilishPage'
import { PickListsPage } from '../pages/admin/PickListsPage'
import { AdminPickListDetailPage } from '../pages/admin/AdminPickListDetailPage'
import { OfflineQueuePage } from '../pages/offline/OfflineQueuePage'
import { PickingViewReadOnlyPage } from '../pages/picking/PickingViewReadOnlyPage'
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
import { ControllerPickListReadOnlyPage } from '../pages/controller/ControllerPickListReadOnlyPage'
import { ControllerProductsPage } from '../pages/controller/ControllerProductsPage'
import { ControllerProductDetailPage } from '../pages/controller/ControllerProductDetailPage'
import { ControllerSettingsPage } from '../pages/controller/ControllerSettingsPage'
import { ControllerProfilePage } from '../pages/controller/ControllerProfilePage'
import { LoginPage } from '../pages/LoginPage'
import { NotAuthorizedPage as AppNotAuthorizedPage } from '../pages/NotAuthorizedPage'
import { LoadingOverlay } from '../components/ui/LoadingOverlay'

/** Eski `/admin/order-statuses?group=…` havolalarini Jarayon (picking) ga yo'naltirish. */
function OrderStatusesToPickingRedirect() {
  const [params] = useSearchParams()
  const g = (params.get('group') || '').trim()
  if (!g || g === 'all') {
    return <Navigate to="/admin/picking" replace />
  }
  if (g === 'yakunlangan') {
    return <Navigate to="/admin/picking/archive?group=yakunlangan" replace />
  }
  return <Navigate to={`/admin/picking?group=${encodeURIComponent(g)}`} replace />
}

function SmartRedirect() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="relative min-h-screen">
        <LoadingOverlay fullScreen />
      </div>
    )
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
          path="/picking/view/:documentId"
          element={
            <RequireRoleOrPermission permission="picking:read">
              <PickingViewReadOnlyPage />
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
          path="/controller/documents/view/:documentId"
          element={
            <RequireRoleOrPermission permissions={['documents:read', 'products:read']}>
              <ControllerLayout>
                <RequireRoleOrPermission permission="picking:read">
                  <ControllerPickListReadOnlyPage />
                </RequireRoleOrPermission>
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
              <RequirePermission permission="picking:read">
                <OrderStatusesToPickingRedirect />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/orders-diller"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="orders:read">
                <OrdersPage orderSource="diller" />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/orders-diller/:movementId"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="orders:read">
                <MovementDetailsPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/orders-orikzor"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="orders:read">
                <OrikzorHarakatlariPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/orders-orikzor/:movementId"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="orders:read">
                <MovementDetailsPage />
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
          path="/admin/settings"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="orders:read">
                <AdminSettingsPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/vip-customers"
          element={<Navigate to="/admin/settings?tab=vip-customers" replace />}
        />
        <Route
          path="/admin/work-zones"
          element={<Navigate to="/admin/settings?tab=work-zones" replace />}
        />
        <Route
          path="/admin/organizations"
          element={<Navigate to="/admin/settings?tab=organizations" replace />}
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
          path="/admin/picking/cancelled"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="picking:read">
                <PickListsPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/picking/archive"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="picking:read">
                <PickListsPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/picking/:documentId"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="picking:read">
                <AdminPickListDetailPage />
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
          path="/admin/inventory/smartup-balance"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="inventory:read">
                <SmartupBalancePage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/inventory/smartup-bron"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="inventory:read">
                <SmartupBronPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/inventory/smartup-custom"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="inventory:read">
                <SmartupCustomPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/inventory/reserve-history"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="inventory:read">
                <InventoryReserveHistoryPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/inventory/reserve-health"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="inventory:read">
                <InventoryReserveHealthPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/inventory/movements"
          element={<Navigate to="/admin/movement" replace />}
        />
        <Route
          path="/admin/movement"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="movements:read">
                <MovementPage />
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
          path="/admin/receiving/:id"
          element={<Navigate to="/admin/receiving" replace />}
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
          path="/admin/kamomat"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="movements:read">
                <KamomatlarPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/returns-history"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="orders:read">
                <ReturnsHistoryPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/returns-history/:id"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="orders:read">
                <ReturnDetailsPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="/admin/kamomat/yoq-qilish"
          element={
            <RequirePermission permission="admin:access" redirectTo="/not-authorized">
              <RequirePermission permission="inventory:adjust">
                <MahsulotYoqQilishPage />
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
