/**
 * Home — Scan (Scanner) va Picker ga kirish.
 */
import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';
import { BRAND } from '../config/branding';

type HomeNav = StackNavigationProp<RootStackParamList, 'Home'>;

export function HomeScreen() {
  const navigation = useNavigation<HomeNav>();

  return (
    <View style={styles.container}>
      <Image source={require('../assets/logo.png')} style={[styles.logo, { width: BRAND.loginLogoSize, height: BRAND.loginLogoSize }]} resizeMode="contain" />
      <Text style={styles.brand}>{BRAND.name}</Text>
      <Text style={styles.subtitle}>Skaner yoki terish (Picker)</Text>

      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={() => navigation.navigate('PickerHome')}
        activeOpacity={0.8}
      >
        <Text style={styles.primaryBtnText}>Picker / Yig‘uvchi</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryBtn}
        onPress={() => navigation.navigate('Scanner')}
        activeOpacity={0.8}
      >
        <Text style={styles.secondaryBtnText}>Skaner (barcode)</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#f5f5f5',
  },
  logo: {
    marginBottom: 8,
  },
  brand: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111',
    marginBottom: 4,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 32,
  },
  primaryBtn: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#1976d2',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  secondaryBtn: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#fff',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  secondaryBtnText: {
    color: '#333',
    fontSize: 18,
    fontWeight: '600',
  },
});
