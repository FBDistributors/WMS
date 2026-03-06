/**
 * Ekranni pastki footer bilan o'rab, Buyurtmalar/Mahsulotlar/Hisob da menyu doim ko'rinsin.
 * Yon siljish (swipe) bilan keyingi/oldingi menyuga o'tish.
 * Orqaga bosilganda bir zarbada PickerHome ga qaytadi.
 */
import React, { useMemo, useCallback } from 'react';
import { BackHandler, View, StyleSheet, PanResponder } from 'react-native';
import { CommonActions, useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';
import { PickerFooter } from './PickerFooter';

type FooterRouteName = 'PickTaskList' | 'Inventory' | 'Kirim' | 'Hisob';

const TAB_ORDER: ('PickerHome' | FooterRouteName)[] = ['PickerHome', 'PickTaskList', 'Inventory', 'Kirim', 'Hisob'];
const SWIPE_MIN = 60;
const SWIPE_VELOCITY_MIN = 0.2;

export function withPickerFooter<P extends object>(
  Component: React.ComponentType<P>,
  footerRoute: FooterRouteName
) {
  function Wrapped(props: P) {
    const route = useRoute<RouteProp<RootStackParamList, keyof RootStackParamList>>();
    const navigation = useNavigation<StackNavigationProp<RootStackParamList, keyof RootStackParamList>>();
    const profileType =
      (route.params as { profileType?: 'picker' | 'controller' })?.profileType ?? 'picker';

    const navigateSwipe = useCallback(
      (direction: 'left' | 'right') => {
        const idx = TAB_ORDER.indexOf(footerRoute);
        if (direction === 'left' && idx < TAB_ORDER.length - 1) {
          navigation.navigate(TAB_ORDER[idx + 1] as any, { profileType });
        } else if (direction === 'right' && idx > 0) {
          navigation.navigate(TAB_ORDER[idx - 1] as any, { profileType });
        }
      },
      [footerRoute, navigation, profileType]
    );

    const panResponder = useMemo(
      () =>
        PanResponder.create({
          onStartShouldSetPanResponder: () => false,
          onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 15,
          onPanResponderRelease: (_, g) => {
            const { dx, vx } = g;
            if (dx > SWIPE_MIN || vx > SWIPE_VELOCITY_MIN) {
              navigateSwipe('right');
            } else if (dx < -SWIPE_MIN || vx < -SWIPE_VELOCITY_MIN) {
              navigateSwipe('left');
            }
          },
        }),
      [navigateSwipe]
    );

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
        <View style={styles.content} {...panResponder.panHandlers}>
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
