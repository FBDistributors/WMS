import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { AdminLayout } from '../../admin/components/AdminLayout'
import { SettingsHubTabs, type SettingsHubTabId } from '../../admin/components/SettingsHubTabs'
import { VipCustomersSection } from './VipCustomersPage'
import { OrganizationsSection } from './OrganizationsPage'
import { WorkZonesSection } from './WorkZonesPage'

const TAB_PARAM = 'tab'
const DEFAULT_TAB: SettingsHubTabId = 'vip-customers'

function parseTab(raw: string | null): SettingsHubTabId {
  if (raw === 'work-zones' || raw === 'vip-customers' || raw === 'organizations') return raw
  return DEFAULT_TAB
}

export function AdminSettingsPage() {
  const { t } = useTranslation(['admin', 'common'])
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = parseTab(searchParams.get(TAB_PARAM))
  const [headerAction, setHeaderAction] = useState<ReactNode | null>(null)

  const setTab = useCallback(
    (next: SettingsHubTabId) => {
      setSearchParams(next === DEFAULT_TAB ? {} : { [TAB_PARAM]: next }, { replace: true })
    },
    [setSearchParams],
  )

  const setHeaderActionStable = useCallback((node: ReactNode | null) => {
    setHeaderAction(node)
  }, [])

  const content = useMemo(() => {
    if (tab === 'work-zones') {
      return <WorkZonesSection embedded setHeaderAction={setHeaderActionStable} />
    }
    if (tab === 'organizations') {
      return <OrganizationsSection embedded setHeaderAction={setHeaderActionStable} />
    }
    return <VipCustomersSection embedded setHeaderAction={setHeaderActionStable} />
  }, [tab, setHeaderActionStable])

  return (
    <AdminLayout title={t('admin:settings_hub.title')} actionSlot={headerAction}>
      <div className="space-y-4">
        <SettingsHubTabs value={tab} onChange={setTab} />
        {content}
      </div>
    </AdminLayout>
  )
}
