import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
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

export function ScannerScreen() {
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
      fetchByBarcode(value);
    },
    [fetchByBarcode]
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

  if (permStatus === 'loading' || !device) {
    return (
      <View style={styles.centered}>
        {!device ? (
          <Text style={styles.message}>No camera device</Text>
        ) : (
          <ActivityIndicator size="large" color="#333" />
        )}
      </View>
    );
  }

  if (permStatus !== 'granted') {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>Camera access is required to scan barcodes.</Text>
        <TouchableOpacity style={styles.button} onPress={handleRequestPermission}>
          <Text style={styles.buttonText}>
            {permStatus === 'denied' ? 'Open Settings' : 'Allow Camera'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isScanning}
        codeScanner={codeScanner}
      />
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
  message: {
    fontSize: 16,
    color: '#333',
    textAlign: 'center',
    marginBottom: 16,
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
  overlay: {
    position: 'absolute',
    top: 48,
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
