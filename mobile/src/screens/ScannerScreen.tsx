import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../types/navigation';
import {
  Camera,
  useCameraDevice,
  useCodeScanner,
} from 'react-native-vision-camera';
import { useCameraPermission } from '../hooks/useCameraPermission';
import { useProductByBarcode } from '../hooks/useProductByBarcode';
import { ProductCard } from '../components/ProductCard';

const DEBOUNCE_MS = 1500;
const SUPPORTED_CODE_TYPES = ['ean-13', 'ean-8', 'code-128', 'qr'] as const;

type ScannerRoute = RouteProp<RootStackParamList, 'Scanner'>;

export function ScannerScreen() {
  const navigation = useNavigation();
  const route = useRoute<ScannerRoute>();
  const params = route.params ?? {};
  const device = useCameraDevice('back');
  const { status: permStatus, requestOrOpenSettings } = useCameraPermission();
  const { product, error, status: fetchStatus, fetchByBarcode, reset } = useProductByBarcode();
  const lastScannedRef = useRef<string | null>(null);
  const lastScannedAtRef = useRef<number>(0);
  const [isScanning, setIsScanning] = useState(true);

  const onCodeScanned = useCallback(
    (codes: { value?: string }[]) => {
      const value = codes[0]?.value?.trim();
      if (!value) return;
      const now = Date.now();
      if (value === lastScannedRef.current && now - lastScannedAtRef.current < DEBOUNCE_MS) {
        return;
      }
      lastScannedRef.current = value;
      lastScannedAtRef.current = now;
      setIsScanning(false);

      if (params.returnToPick && params.taskId && params.lineId) {
        navigation.navigate('PickTaskDetails', {
          taskId: params.taskId,
          lineId: params.lineId,
          scannedBarcode: value,
        });
        return;
      }
      fetchByBarcode(value);
    },
    [fetchByBarcode, params.returnToPick, params.taskId, params.lineId, navigation]
  );

  const codeScanner = useCodeScanner({
    codeTypes: [...SUPPORTED_CODE_TYPES],
    onCodeScanned,
    scanInterval: 500,
  });

  const handleRequestPermission = useCallback(async () => {
    const granted = await requestOrOpenSettings();
    if (!granted) return;
  }, [requestOrOpenSettings]);

  const handleScanAgain = useCallback(() => {
    reset();
    lastScannedRef.current = null;
    lastScannedAtRef.current = 0;
    setIsScanning(true);
  }, [reset]);

  // Loading or no device: show visible UI (not black)
  if (permStatus === 'loading' || !device) {
    return (
      <View style={[styles.centered, styles.whiteBg]}>
        <Text style={styles.message}>Camera screen loading…</Text>
        {!device ? (
          <Text style={styles.messageSmall}>No camera device (emulator may have none)</Text>
        ) : (
          <ActivityIndicator size="large" color="#333" />
        )}
      </View>
    );
  }

  // Permission denied / not determined: show permission UI (visible, not black)
  if (permStatus !== 'granted') {
    return (
      <View style={[styles.centered, styles.whiteBg]}>
        <Text style={styles.message}>Camera access is required to scan barcodes.</Text>
        <Text style={styles.messageSmall}>
          {permStatus === 'denied' ? 'Permission denied. Open Settings to enable.' : 'Tap below to allow.'}
        </Text>
        <TouchableOpacity style={styles.button} onPress={handleRequestPermission}>
          <Text style={styles.buttonText}>
            {permStatus === 'denied' ? 'Open Settings' : 'Allow Camera'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Permission granted: render camera + always-visible overlay (confirms screen is rendering even if preview is black)
  return (
    <View style={StyleSheet.absoluteFill}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isScanning}
        codeScanner={codeScanner}
      />
      {/* Overlay: confirms scanner screen is rendering (preview may be black on emulator) */}
      <View style={styles.overlayBanner}>
        {params.returnToPick ? (
          <>
            <Text style={styles.overlayBannerText}>Terish uchun shtrixni skanerlang</Text>
            <TouchableOpacity
              style={styles.backBtnOverlay}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.buttonText}>Orqaga</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.overlayBannerText}>Scanner active — point at barcode (EAN/Code128/QR)</Text>
            <Text style={styles.overlayBannerSub}>Preview may be black on emulator; use real device to test camera.</Text>
          </>
        )}
      </View>
      <View style={styles.overlay}>
        <Text style={styles.hint}>
          Point at a barcode (EAN / Code128 / QR)
        </Text>
      </View>

      {fetchStatus === 'loading' && (
        <View style={styles.resultBox}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.resultText}>Looking up product…</Text>
        </View>
      )}

      {fetchStatus === 'error' && error && (
        <View style={styles.resultBox}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.buttonSmall} onPress={handleScanAgain}>
            <Text style={styles.buttonText}>Scan again</Text>
          </TouchableOpacity>
        </View>
      )}

      {fetchStatus === 'success' && product && (
        <View style={styles.resultBox}>
          <ProductCard product={product} />
          <TouchableOpacity style={styles.buttonSmall} onPress={handleScanAgain}>
            <Text style={styles.buttonText}>Scan another</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#f5f5f5',
  },
  whiteBg: {
    backgroundColor: '#fff',
  },
  message: {
    fontSize: 18,
    color: '#111',
    textAlign: 'center',
    marginBottom: 8,
  },
  messageSmall: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#333',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonSmall: {
    alignSelf: 'center',
    backgroundColor: '#333',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 12,
  },
  overlayBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  overlayBannerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  overlayBannerSub: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 2,
  },
  backBtnOverlay: {
    alignSelf: 'center',
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 8,
  },
  overlay: {
    position: 'absolute',
    top: 56,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hint: {
    color: '#fff',
    fontSize: 14,
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  resultBox: {
    position: 'absolute',
    bottom: 32,
    left: 0,
    right: 0,
    alignItems: 'stretch',
  },
  resultText: {
    color: '#fff',
    marginTop: 8,
    textAlign: 'center',
  },
  errorText: {
    color: '#fff',
    backgroundColor: 'rgba(200,0,0,0.9)',
    padding: 12,
    borderRadius: 8,
    marginHorizontal: 16,
    textAlign: 'center',
  },
});
