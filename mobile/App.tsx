/**
 * WMS Mobile — Render wms-api ga ulangan.
 * Stack: Login, Home, PickerHome → PickTaskList → PickTaskDetails, Scanner.
 */
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { LocaleProvider } from './src/i18n/LocaleContext';
import type { RootStackParamList } from './src/types/navigation';
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { PickerHome } from './src/screens/PickerHome';
import { PickTaskList } from './src/screens/PickTaskList';
import { PickTaskDetails } from './src/screens/PickTaskDetails';
import { PickerScreen } from './src/screens/PickerScreen';
import { ScannerScreen } from './src/screens/ScannerScreen';
import { AccountScreen } from './src/screens/AccountScreen';
import { InventoryScreen } from './src/screens/InventoryScreen';
import { InventoryDetailScreen } from './src/screens/InventoryDetailScreen';

const Stack = createStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <LocaleProvider>
      <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Login"
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="PickerHome" component={PickerHome} />
        <Stack.Screen name="PickTaskList" component={PickTaskList} />
        <Stack.Screen name="PickTaskDetails" component={PickTaskDetails} />
        <Stack.Screen name="Picker" component={PickerScreen} />
        <Stack.Screen name="Scanner" component={ScannerScreen} />
        <Stack.Screen name="Hisob" component={AccountScreen} />
        <Stack.Screen name="Inventory" component={InventoryScreen} />
        <Stack.Screen name="InventoryDetail" component={InventoryDetailScreen} />
      </Stack.Navigator>
    </NavigationContainer>
    </LocaleProvider>
  );
}
