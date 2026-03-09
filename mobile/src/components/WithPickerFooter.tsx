/**
 * Ekranni pastki footer bilan o'rab, Buyurtmalar/Mahsulotlar/Hisob da menyu doim ko'rinsin.
 * Navigatsiya faqat pastki menyu orqali.
 * Orqaga bosilganda bir zarbada PickerHome ga qaytadi.
 */
import React, { useCallback } from 'react';
import { BackHandler, View, StyleSheet } from 'react-native';
import { CommonActions, useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';
import { useProfileType } from '../context/ProfileTypeContext';
import { PickerFooter } from './PickerFooter';

type FooterRouteName = 'PickTaskList' | 'Inventory' | 'Kirim' | 'Hisob';

export function withPickerFooter<P extends object>(
  Component: React.ComponentType<P>,
  footerRoute: FooterRouteName
) {
  function Wrapped(props: P) {
    const route = useRoute<RouteProp<RootStackParamList, keyof RootStackParamList>>();
    const navigation = useNavigation<StackNavigationProp<RootStackParamList, keyof RootStackParamList>>();
    const profileType =
      (route.params as { profileType?: 'picker' | 'controller' })?.profileType
      ?? useProfileType().profileType
      ?? 'picker';

    useFocusEffect(
      useCallback(() => {
        const onBack = () => {
          const state = navigation.getState();
          const pickerHomeIndex = state.routes.findIndex((r) => r.name === 'PickerHome');
          if (pickerHomeIndex === -1) return false;
          navigation.dispatch(
            CommonActions.reset({
              index: pickerHomeIndex,
              routes: state.routes.slice(0, pickerHomeIndex + 1),
            })
          );
          return true;
        };
        const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
        return () => sub.remove();
      }, [navigation])
    );

    return (
      <View style={styles.wrap}>
        <View style={styles.content}>
          <Component {...props} />
        </View>
        {footerRoute !== 'Hisob' && (
          <PickerFooter currentRoute={footerRoute} profileType={profileType} />
        )}
      </View>
    );
  }
  Wrapped.displayName = `WithPickerFooter(${Component.displayName ?? Component.name ?? 'Screen'})`;
  return Wrapped;
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});
