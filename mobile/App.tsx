/**
 * WMS Mobile — Render wms-api ga ulangan.
 * Stack: Login, Home, PickerHome → PickTaskList → PickTaskDetails, Scanner.
 * Offline MVP: cache + queue + sync.
 * Push: bildirishnoma bosilganda buyurtmaga ochiladi (FCM — PUSH_SETUP.md).
 */
import React, { useEffect, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { LocaleProvider } from './src/i18n/LocaleContext';
import { ThemeProvider } from './src/theme/ThemeContext';
import { NetworkProvider } from './src/network';
import type { RootStackParamList } from './src/types/navigation';
import { initNotificationOpenedListener } from './src/notifications/pushNotifications';
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { PickerHome } from './src/screens/PickerHome';
import { PickTaskList } from './src/screens/PickTaskList';
import { ConsolidatedPickScreen } from './src/screens/ConsolidatedPickScreen';
import { PickTaskDetails } from './src/screens/PickTaskDetails';
import { PickerScreen } from './src/screens/PickerScreen';
import { ScannerScreen } from './src/screens/ScannerScreen';
import { AccountScreen } from './src/screens/AccountScreen';
import { InventoryScreen } from './src/screens/InventoryScreen';
import { InventoryDetailScreen } from './src/screens/InventoryDetailScreen';
import { QueueScreen } from './src/screens/QueueScreen';
import { ReturnsRedirectScreen } from './src/screens/ReturnsRedirectScreen';
import { KirimScreen } from './src/screens/KirimScreen';
import { KirimFormScreen } from './src/screens/KirimFormScreen';
import { MovementScreen } from './src/screens/MovementScreen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { withPickerFooter } from './src/components/WithPickerFooter';
import { TaskCountProvider } from './src/context/TaskCountContext';
import { ProfileTypeProvider, PROFILE_TYPE_KEY } from './src/context/ProfileTypeContext';

const Stack = createStackNavigator<RootStackParamList>();

export default function App() {
  const navigationRef = useRef<any>(null);

  useEffect(() => {
    const cleanup = initNotificationOpenedListener((data) => {
      if (!data.taskId || !navigationRef.current?.isReady()) return;
      AsyncStorage.getItem(PROFILE_TYPE_KEY).then((stored) => {
        const profileType = stored === 'controller' ? 'controller' : 'picker';
        navigationRef.current?.navigate('PickTaskDetails', {
          taskId: data.taskId,
          profileType,
        });
      });
    });
    return cleanup;
  }, []);

  const PickTaskListWithFooter = React.useMemo(
    () => withPickerFooter(PickTaskList, 'PickTaskList'),
    []
  );
  const InventoryWithFooter = React.useMemo(
    () => withPickerFooter(InventoryScreen, 'Inventory'),
    []
  );
  const HisobWithFooter = React.useMemo(
    () => withPickerFooter(AccountScreen, 'Hisob'),
    []
  );
  const KirimWithFooter = React.useMemo(
    () => withPickerFooter(KirimScreen, 'Kirim'),
    []
  );

  return (
    <LocaleProvider>
      <ThemeProvider>
      <ProfileTypeProvider>
      <TaskCountProvider>
      <NetworkProvider>
      <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        id="root"
        initialRouteName="Login"
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="PickerHome" component={PickerHome} />
        <Stack.Screen name="PickTaskList" component={PickTaskListWithFooter} />
        <Stack.Screen name="ConsolidatedPick" component={ConsolidatedPickScreen} />
        <Stack.Screen name="PickTaskDetails" component={PickTaskDetails} />
        <Stack.Screen name="Picker" component={PickerScreen} />
        <Stack.Screen name="Scanner" component={ScannerScreen} />
        <Stack.Screen name="Hisob" component={HisobWithFooter} />
        <Stack.Screen name="Inventory" component={InventoryWithFooter} />
        <Stack.Screen name="InventoryDetail" component={InventoryDetailScreen} />
        <Stack.Screen name="QueueScreen" component={QueueScreen} />
        <Stack.Screen name="Returns" component={ReturnsRedirectScreen} />
        <Stack.Screen name="Kirim" component={KirimWithFooter} />
        <Stack.Screen name="KirimForm" component={KirimFormScreen} />
        <Stack.Screen name="Movement" component={MovementScreen} />
      </Stack.Navigator>
    </NavigationContainer>
    </NetworkProvider>
    </TaskCountProvider>
    </ProfileTypeProvider>
    </ThemeProvider>
    </LocaleProvider>
  );
}
