import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { CommonActions } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { RootStackParamList } from '../types/navigation';
import {
  Camera,
  useCameraDevice,
  useCodeScanner,
} from 'react-native-vision-camera';
import { useCameraPermission } from '../hooks/useCameraPermission';
import { useProductByBarcode } from '../hooks/useProductByBarcode';
import { ProductCard } from '../components/ProductCard';
import { UNAUTHORIZED_MSG } from '../api/client';
import { resolveScannerBarcode } from '../api/scanner';
import { useLocale } from '../i18n/LocaleContext';
import { useTheme } from '../theme/ThemeContext';
import { useProfileType } from '../context/ProfileTypeContext';

const DEBOUNCE_MS = 1500;
const SUPPORTED_CODE_TYPES = ['ean-13', 'ean-8', 'code-128', 'qr'] as const;

/**
 * Qoida: Kamera faqat foydalanuvchi "Scan" tugmasini bosganda ochiladi (bu ekranga
 * faqat navigate('Scanner') orqali kelinadi). Skan qilib qaytishda CommonActions.reset
 * bilan Scanner stack dan olib tashlanadi — orqaga bosilganda kameraga qaytish bo‘lmasin.
 */

type ScannerRoute = RouteProp<RootStackParamList, 'Scanner'>;

export function ScannerScreen() {
  const navigation = useNavigation();
  const route = useRoute<ScannerRoute>();
  const { t } = useLocale();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const params = route.params ?? {};
  const { profileType: contextProfileType } = useProfileType();
  const device = useCameraDevice('back');
  const { status: permStatus, requestOrOpenSettings } = useCameraPermission();
  const { product, error, status: fetchStatus, fetchByBarcode, reset } = useProductByBarcode();
  const lastScannedRef = useRef<string | null>(null);
  const lastScannedAtRef = useRef<number>(0);
  const [isScanning, setIsScanning] = useState(true);
  const [torchOn, setTorchOn] = useState(false);

  const resetToMovement = useCallback(
    (movementParams?: { scannedProductId?: string; scannedBarcode?: string; scannedLocationCode?: string }) => {
      navigation.dispatch(
        CommonActions.reset({
          index: 2,
          routes: [
            { name: 'PickerHome', params: { profileType: contextProfileType ?? 'picker' } },
            { name: 'Kirim' },
            { name: 'Movement', params: movementParams },
          ],
        })
      );
    },
    [navigation, contextProfileType]
  );

  const resetToKirimForm = useCallback(
    (kirimParams: {
      flow: 'new' | 'return' | 'inventory';
      newMode?: 'byScan' | 'byLocation';
      warehouse?: 'main' | 'showroom';
      scannedProductId?: string;
      scannedBarcode?: string;
      inventoryStep?: 1 | 2 | 3;
      inventoryLocationId?: string;
      inventoryLocationCode?: string;
      receivingLocationId?: string;
      receivingLocationCode?: string;
    }) => {
      const routes: Array<{ name: keyof RootStackParamList; params?: any }> = [
        { name: 'PickerHome', params: { profileType: contextProfileType ?? 'picker' } },
        { name: 'Kirim' },
      ];
      if (kirimParams.flow === 'new') routes.push({ name: 'KirimNew' });
      routes.push({ name: 'KirimForm', params: kirimParams });
      navigation.dispatch(
        CommonActions.reset({
          index: routes.length - 1,
          routes,
        })
      );
    },
    [navigation, contextProfileType]
  );

  const resetToInventoryDetail = useCallback(
    (productId?: string) => {
      if (!productId) {
        navigation.dispatch(
          CommonActions.reset({
            index: 1,
            routes: [
              { name: 'PickerHome', params: { profileType: contextProfileType ?? 'picker' } },
              { name: 'Inventory' },
            ],
          })
        );
        return;
      }
      navigation.dispatch(
        CommonActions.reset({
          index: 2,
          routes: [
            { name: 'PickerHome', params: { profileType: contextProfileType ?? 'picker' } },
            { name: 'Inventory' },
            { name: 'InventoryDetail', params: { productId } },
          ],
        })
      );
    },
    [navigation, contextProfileType]
  );

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

      if (params.returnToPick && params.taskId) {
        const profileType = params.profileType ?? contextProfileType ?? 'picker';
        const navParams: { taskId: string; scannedBarcode: string; profileType: string; lineId?: string } = {
          taskId: params.taskId,
          scannedBarcode: value,
          profileType,
        };
        if (params.lineId) navParams.lineId = params.lineId;
        navigation.dispatch(
          CommonActions.reset({
            index: 2,
            routes: [
              { name: 'PickerHome', params: { profileType } },
              { name: 'PickTaskList', params: { profileType } },
              { name: 'PickTaskDetails', params: navParams },
            ],
          })
        );
        return;
      }
      if (params.returnToConsolidated) {
        const profileType = params.profileType ?? contextProfileType ?? 'picker';
        navigation.dispatch(
          CommonActions.reset({
            index: 1,
            routes: [
              { name: 'PickerHome', params: { profileType } },
              {
                name: 'PickTaskList',
                params: {
                  profileType,
                  scannedBarcode: value,
                  openConsolidated: true,
                  selectedProductKey: params.selectedProductKey,
                },
              },
            ],
          })
        );
        return;
      }
      if (params.returnToMovementPallet) {
        resolveScannerBarcode(value)
          .then((out) => {
            if (out.type === 'LOCATION' && out.location) {
              resetToMovement({ scannedLocationCode: out.location.code });
            } else if (out.type === 'PRODUCT') {
              Alert.alert(t('error'), t('movementPalletScanWantLocation'));
              lastScannedRef.current = null;
              lastScannedAtRef.current = 0;
              setIsScanning(true);
            } else {
              Alert.alert(t('error'), out.message || t('movementPalletLocationUnknown'));
              lastScannedRef.current = null;
              lastScannedAtRef.current = 0;
              setIsScanning(true);
            }
          })
          .catch((e) => {
            Alert.alert(t('error'), e instanceof Error ? e.message : String(e));
            lastScannedRef.current = null;
            lastScannedAtRef.current = 0;
            setIsScanning(true);
          });
        return;
      }
      if (params.returnToKirimLocation && params.flow === 'new') {
        resolveScannerBarcode(value)
          .then((out) => {
            if (out.type === 'LOCATION' && out.location) {
              resetToKirimForm({
                flow: 'new',
                newMode: 'byLocation',
                warehouse: params.warehouse ?? 'main',
                receivingLocationId: out.location.id,
                receivingLocationCode: out.location.code,
              });
            } else if (out.type === 'PRODUCT') {
              Alert.alert(t('error'), t('kirimScanWantLocation'));
              lastScannedRef.current = null;
              lastScannedAtRef.current = 0;
              setIsScanning(true);
            } else {
              Alert.alert(t('error'), out.message || t('kirimLocationUnknown'));
              lastScannedRef.current = null;
              lastScannedAtRef.current = 0;
              setIsScanning(true);
            }
          })
          .catch((e) => {
            Alert.alert(t('error'), e instanceof Error ? e.message : String(e));
            lastScannedRef.current = null;
            lastScannedAtRef.current = 0;
            setIsScanning(true);
          });
        return;
      }
      fetchByBarcode(value);
    },
    [
      fetchByBarcode,
      params.returnToPick,
      params.returnToConsolidated,
      params.returnToMovementPallet,
      params.returnToKirimLocation,
      resetToMovement,
      resetToKirimForm,
      params.flow,
      params.newMode,
      params.warehouse,
      params.taskId,
      params.profileType,
      params.selectedProductKey,
      contextProfileType,
      navigation,
      t,
    ]
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

  // Terish uchun skaner: PickTaskDetails ga yo'naltirish (onCodeScanned da bajariladi)
  // Kirim forma uchun: KirimForm ga flow + productId bilan qaytish
  // Movement: Ko'chirish ekraniga productId bilan qaytish
  // Eski Returns: Returns sahifasiga productId bilan qaytish
  useEffect(() => {
    if (fetchStatus !== 'success' || !product) return;
    if (params.returnToPick) return;
    if (params.returnToMovementPallet) return;
    if (params.returnToKirimLocation) return;
    if (params.returnToKirimForm) {
      resetToKirimForm({
        flow: params.flow ?? 'return',
        newMode: params.newMode,
        warehouse: params.warehouse,
        scannedProductId: product.product_id,
        scannedBarcode: product.barcode ?? undefined,
        inventoryStep: params.inventoryStep,
        inventoryLocationId: params.inventoryLocationId,
        inventoryLocationCode: params.inventoryLocationCode,
      });
      return;
    }
    if (params.returnToMovement) {
      resetToMovement({
        scannedProductId: product.product_id,
        scannedBarcode: product.barcode ?? undefined,
      });
      return;
    }
    if (params.returnToReturns) {
      resetToKirimForm({
        flow: 'return',
        scannedProductId: product.product_id,
        scannedBarcode: product.barcode ?? undefined,
      });
      return;
    }
    resetToInventoryDetail(product.product_id);
  }, [
    fetchStatus,
    product,
    params.returnToPick,
    params.returnToReturns,
    params.returnToKirimForm,
    params.returnToMovement,
    params.returnToMovementPallet,
    params.returnToKirimLocation,
    params.returnToInventoryDetail,
    params.flow,
    params.newMode,
    params.warehouse,
    resetToMovement,
    resetToKirimForm,
    resetToInventoryDetail,
    navigation,
  ]);

  const handleScannerBack = useCallback(() => {
    if (params.returnToMovement || params.returnToMovementPallet) {
      resetToMovement();
      return;
    }
    if (params.returnToKirimLocation && params.flow === 'new') {
      resetToKirimForm({
        flow: 'new',
        newMode: 'byLocation',
        warehouse: params.warehouse ?? 'main',
      });
      return;
    }
    if (params.returnToKirimForm) {
      resetToKirimForm({
        flow: params.flow ?? 'return',
        newMode: params.newMode,
        warehouse: params.warehouse,
      });
      return;
    }
    if (params.returnToReturns) {
      resetToKirimForm({ flow: 'return' });
      return;
    }
    if (params.returnToInventoryDetail) {
      resetToInventoryDetail();
      return;
    }
    navigation.goBack();
  }, [
    params.returnToMovement,
    params.returnToMovementPallet,
    params.returnToKirimLocation,
    params.returnToKirimForm,
    params.returnToReturns,
    params.returnToInventoryDetail,
    params.flow,
    params.newMode,
    params.warehouse,
    resetToMovement,
    resetToKirimForm,
    resetToInventoryDetail,
    navigation,
  ]);

  // Loading or no device: show visible UI (not black)
  if (permStatus === 'loading' || !device) {
    return (
      <View style={[styles.centered, isDark ? styles.centeredDark : styles.whiteBg]}>
        <Text style={[styles.message, isDark && styles.messageDark]}>Camera screen loading…</Text>
        {!device ? (
          <Text style={[styles.messageSmall, isDark && styles.messageSmallDark]}>No camera device (emulator may have none)</Text>
        ) : (
          <ActivityIndicator size="large" color={isDark ? '#93c5fd' : '#333'} />
        )}
      </View>
    );
  }

  // Permission denied / not determined: show permission UI (visible, not black)
  if (permStatus !== 'granted') {
    return (
      <View style={[styles.centered, isDark ? styles.centeredDark : styles.whiteBg]}>
        <Text style={[styles.message, isDark && styles.messageDark]}>Camera access is required to scan barcodes.</Text>
        <Text style={[styles.messageSmall, isDark && styles.messageSmallDark]}>
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
        torch={torchOn ? 'on' : 'off'}
      />
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={handleScannerBack}
        >
          <Icon name="arrow-left" size={26} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.iconBtn, torchOn && styles.iconBtnActive]}
          onPress={() => setTorchOn((v) => !v)}
        >
          <Icon name={torchOn ? 'flashlight-off' : 'flashlight'} size={26} color="#fff" />
        </TouchableOpacity>
      </View>

      {fetchStatus === 'loading' && (
        <View style={styles.resultBox}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.resultText}>Looking up product…</Text>
        </View>
      )}

      {fetchStatus === 'error' && error && (
        <View style={styles.resultBox}>
          <Text style={styles.errorText}>
            {error === UNAUTHORIZED_MSG ? t('authErrorPleaseLogin') : error}
          </Text>
          {error === UNAUTHORIZED_MSG ? (
            <TouchableOpacity
              style={styles.buttonSmall}
              onPress={() => (navigation as any).replace('Login')}
            >
              <Text style={styles.buttonText}>{t('loginButton')}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.buttonSmall} onPress={handleScanAgain}>
              <Text style={styles.buttonText}>Scan again</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {fetchStatus === 'success' && product && (
        <View style={styles.resultBox}>
          <ProductCard product={product} />
          {params.returnToPick ? (
            <TouchableOpacity style={styles.buttonSmall} onPress={handleScanAgain}>
              <Text style={styles.buttonText}>Scan another</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.resultText}>Mahsulot tafsilotiga yo'naltirilmoqda…</Text>
          )}
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
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    paddingTop: 40,
  },
  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBtnActive: {
    backgroundColor: 'rgba(255,193,7,0.9)',
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
  centeredDark: { backgroundColor: '#0f172a' },
  messageDark: { color: '#f1f5f9' },
  messageSmallDark: { color: '#94a3b8' },
});
