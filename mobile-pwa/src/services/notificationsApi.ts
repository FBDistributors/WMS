import { fetchJSON } from './apiClient'

export type NotificationsPushStatus = {
  fcm_server_configured: boolean
  fcm_credential_source: string
  registered_devices_for_current_user: number
  total_fcm_tokens_all_users: number
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

export type NotificationsBroadcastResponse = {
  total_tokens: number
  success: number
  failed: number
}

export async function postNotificationsBroadcast(payload: { title: string; body: string }) {
  return fetchJSON<NotificationsBroadcastResponse>('/api/v1/notifications/broadcast', {
    method: 'POST',
    body: payload,
  })
}
