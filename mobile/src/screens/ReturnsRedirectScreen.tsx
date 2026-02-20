/**
 * Returns route → KirimForm (flow: 'return') redirect.
 * Keeps backward compatibility for deep links / Scanner returnToReturns.
 */
import React, { useEffect } from 'react';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../types/navigation';

export function ReturnsRedirectScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'Returns'>>();

  useEffect(() => {
    navigation.replace('KirimForm', {
      flow: 'return',
      scannedProductId: route.params?.scannedProductId,
      scannedBarcode: route.params?.scannedBarcode,
    });
  }, [navigation, route.params?.scannedProductId, route.params?.scannedBarcode]);

  return null;
}
