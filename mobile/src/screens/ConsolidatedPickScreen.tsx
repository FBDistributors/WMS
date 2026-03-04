/**
 * Umumiy yig'ish: barcha tayinlangan hujjatlar mahsulot bo'yicha bitta ro'yxatda.
 * Header + ConsolidatedPickContent (kontent ajratilgan komponent).
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';
import { useLocale } from '../i18n/LocaleContext';
import { ConsolidatedPickContent } from '../components/ConsolidatedPickContent';

type Nav = StackNavigationProp<RootStackParamList, 'ConsolidatedPick'>;

export function ConsolidatedPickScreen() {
  const { t } = useLocale();
  const navigation = useNavigation<Nav>();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Icon name="arrow-left" size={24} color="#1976d2" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>{t('consolidatedPickTitle')}</Text>
          <Text style={styles.count}>{t('consolidatedMyTasks')}</Text>
        </View>
      </View>
      <ConsolidatedPickContent
        onBack={() => navigation.goBack()}
        onAuthError={() => navigation.replace('Login')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerCenter: { flex: 1, marginLeft: 12 },
  title: { fontSize: 18, fontWeight: '700', color: '#111' },
  count: { fontSize: 13, color: '#666', marginTop: 2 },
});
