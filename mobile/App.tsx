/**
 * WMS Mobile — barcode scanner app (React Native, Android-first).
 */
import React from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import { ScannerScreen } from './src/screens/ScannerScreen';

function App(): React.JSX.Element {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#111" />
      <ScannerScreen />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
  },
});

export default App;
