import { fetchJSON } from './apiClient'

export type NotificationsPushStatus = {
  fcm_server_configured: boolean
  registered_devices_for_current_user: number
}

export type NotificationsTestSelfResponse = {
  sent: boolean
}

export async function getNotificationsPushStatus() {
  return fetchJSON<NotificationsPushStatus>('/api/v1/notifications/push-status')
}

export async function postNotificationsTestSelf() {
  return fetchJSON<NotificationsTestSelfResponse>('/api/v1/notifications/test-self', {
    method: 'POST',
  })
}
