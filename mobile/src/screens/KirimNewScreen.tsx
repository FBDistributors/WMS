/**
 * Kirim > Yangi mahsulotlar — Asosiy yoki Showroom tanlash, keyin KirimForm ga.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { RootStackParamList } from '../types/navigation';
import { useLocale } from '../i18n/LocaleContext';
import { useTheme } from '../theme/ThemeContext';
import { AppHeader } from '../components/AppHeader';

type Nav = StackNavigationProp<RootStackParamList, 'KirimNew'>;

const CARD_BG = '#f0f0f0';
const HEADER_ACCENT = '#1a237e';
const CARD_ICON_SIZE = 28;

export function KirimNewScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useLocale();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]} edges={['top']}>
      <AppHeader
        title={t('kirimNewProducts')}
        showLogo={false}
        showBack={true}
        onBack={() => navigation.goBack()}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <TouchableOpacity
          style={[styles.card, isDark && styles.cardDark]}
          onPress={() => navigation.navigate('KirimForm', { flow: 'new', warehouse: 'main' })}
          activeOpacity={0.7}
        >
          <View style={[styles.cardIconWrap, isDark && styles.cardIconWrapDark]}>
            <Icon name="warehouse" size={CARD_ICON_SIZE} color={isDark ? '#93c5fd' : HEADER_ACCENT} />
          </View>
          <View style={styles.cardBody}>
            <Text style={[styles.cardTitle, isDark && styles.cardTitleDark]}>{t('kirimWarehouseMain')}</Text>
            <Text style={[styles.cardSubtitle, isDark && styles.cardSubtitleDark]}>{t('kirimNewProductsDesc')}</Text>
          </View>
          <Icon name="chevron-right" size={24} color={isDark ? '#94a3b8' : '#777'} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.card, isDark && styles.cardDark]}
          onPress={() => navigation.navigate('KirimForm', { flow: 'new', warehouse: 'showroom' })}
          activeOpacity={0.7}
        >
          <View style={[styles.cardIconWrap, isDark && styles.cardIconWrapDark]}>
            <Icon name="storefront" size={CARD_ICON_SIZE} color={isDark ? '#93c5fd' : HEADER_ACCENT} />
          </View>
          <View style={styles.cardBody}>
            <Text style={[styles.cardTitle, isDark && styles.cardTitleDark]}>{t('kirimWarehouseShowroom')}</Text>
            <Text style={[styles.cardSubtitle, isDark && styles.cardSubtitleDark]}>{t('kirimNewProductsDesc')}</Text>
          </View>
          <Icon name="chevron-right" size={24} color={isDark ? '#94a3b8' : '#777'} />
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
  containerDark: { backgroundColor: '#0f172a' },
  cardDark: { backgroundColor: '#1e293b' },
  cardIconWrapDark: { backgroundColor: '#334155' },
  cardTitleDark: { color: '#f1f5f9' },
  cardSubtitleDark: { color: '#94a3b8' },
});
