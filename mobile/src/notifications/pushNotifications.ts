/**
 * FCM push notifications: token ro'yxatdan o'tkazish va bildirishnoma bosilganda buyurtmaga o'tish.
 * Ishlatish uchun: npm install @react-native-firebase/app @react-native-firebase/messaging
 * va android/app/google-services.json qo'shing. Yo'riqnoma: mobile/PUSH_SETUP.md
 */
import { Platform } from 'react-native';
import apiClient, { getStoredToken } from '../api/client';

type NotificationData = { taskId?: string; type?: string };

let messagingModule: typeof import('@react-native-firebase/messaging').default | null = null;
try {
  messagingModule = require('@react-native-firebase/messaging').default;
} catch {
  // Firebase o'rnatilmagan — push o'chirilgan
}

export function isPushAvailable(): boolean {
  return Boolean(messagingModule);
}

export async function registerPushToken(deviceId?: string): Promise<void> {
  if (!messagingModule) return;
  const token = await getStoredToken();
  if (!token) return;

  try {
    if (Platform.OS === 'ios') {
      const authStatus = await messagingModule!().requestPermission();
      const AUTH = messagingModule?.AuthorizationStatus;
      if (AUTH && authStatus !== AUTH.AUTHORIZED && authStatus !== AUTH.PROVISIONAL) return;
    }
    const fcmToken = await messagingModule!().getToken();
    if (fcmToken) {
      await apiClient.post('/picking/fcm-token', { token: fcmToken, device_id: deviceId ?? undefined });
    }
  } catch (e) {
    if (__DEV__) console.warn('Push register error', e);
  }
}

export function initNotificationOpenedListener(
  onOpen: (data: NotificationData) => void
): () => void {
  if (!messagingModule) return () => {};

  const messaging = messagingModule!();

  const handleNotification = (remoteMessage: { data?: Record<string, string> }) => {
    const data = remoteMessage?.data as NotificationData | undefined;
    if (data?.taskId) onOpen({ taskId: data.taskId, type: data.type });
  };

  const unsubscribe = messaging.onNotificationOpenedApp(handleNotification);

  messaging
    .getInitialNotification()
    .then((remoteMessage) => {
      if (remoteMessage?.data) handleNotification(remoteMessage);
    })
    .catch(() => {});

  return () => {
    if (typeof unsubscribe === 'function') unsubscribe();
  };
}
