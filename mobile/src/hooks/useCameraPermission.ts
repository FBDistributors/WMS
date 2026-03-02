import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking } from 'react-native';
import { Camera } from 'react-native-vision-camera';

export type PermissionStatus = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'loading';

export function useCameraPermission() {
  const [status, setStatus] = useState<PermissionStatus>('loading');

  const check = useCallback(async () => {
    const s = Camera.getCameraPermissionStatus();
    if (s === 'granted') setStatus('granted');
    else if (s === 'denied' || s === 'restricted') setStatus('denied');
    else setStatus('not-determined');
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const request = useCallback(async (): Promise<boolean> => {
    const current = Camera.getCameraPermissionStatus();
    if (current === 'granted') {
      setStatus('granted');
      return true;
    }
    if (current === 'denied' || current === 'restricted') {
      setStatus('denied');
      Alert.alert(
        'Camera access',
        'Camera permission was denied. Open Settings to enable it for this app.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]
      );
      return false;
    }
    try {
      const result = await Camera.requestCameraPermission();
      const granted = result === 'granted';
      setStatus(granted ? 'granted' : 'denied');
      return granted;
    } catch {
      setStatus('denied');
      return false;
    }
  }, []);

  const requestOrOpenSettings = useCallback(async (): Promise<boolean> => {
    const current = Camera.getCameraPermissionStatus();
    if (current === 'granted') return true;
    if (current === 'denied' || current === 'restricted') {
      Alert.alert(
        'Camera required',
        'Camera access is required to scan barcodes. Open Settings to allow access.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]
      );
      return false;
    }
    return request();
  }, [request]);

  return { status, request, requestOrOpenSettings, check };
}
