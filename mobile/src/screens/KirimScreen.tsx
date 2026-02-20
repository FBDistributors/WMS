/**
 * Kirim — ikki yo'nalish: Yangi mahsulotlar, Mijozdan qaytgan mahsulotlar.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { RootStackParamList } from '../types/navigation';
import { useLocale } from '../i18n/LocaleContext';
import { AppHeader } from '../components/AppHeader';

type Nav = StackNavigationProp<RootStackParamList, 'Kirim'>;

const CARD_BG = '#f0f0f0';
const HEADER_ACCENT = '#1a237e';
const CARD_ICON_SIZE = 28;

export function KirimScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useLocale();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader
        title={t('kirimTitle')}
        showLogo={false}
        showBack={true}
        onBack={() => navigation.goBack()}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <TouchableOpacity
          style={styles.card}
          onPress={() => navigation.navigate('KirimForm', { flow: 'new' })}
          activeOpacity={0.7}
        >
          <View style={styles.cardIconWrap}>
            <Icon name="package-variant" size={CARD_ICON_SIZE} color={HEADER_ACCENT} />
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>{t('kirimNewProducts')}</Text>
            <Text style={styles.cardSubtitle}>{t('kirimNewProductsDesc')}</Text>
          </View>
          <Icon name="chevron-right" size={24} color="#777" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.card}
          onPress={() => navigation.navigate('KirimForm', { flow: 'return' })}
          activeOpacity={0.7}
        >
          <View style={styles.cardIconWrap}>
            <Icon name="undo" size={CARD_ICON_SIZE} color={HEADER_ACCENT} />
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>{t('kirimCustomerReturns')}</Text>
            <Text style={styles.cardSubtitle}>{t('kirimCustomerReturnsDesc')}</Text>
          </View>
          <Icon name="chevron-right" size={24} color="#777" />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD_BG,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: '#e0e0e0',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  cardBody: { flex: 1 },
  cardTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#777',
  },
});
