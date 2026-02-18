/**
 * Yig'uvchi sahifasi — rasmga mos: header, 3 ta karta, pastki nav.
 */
import React from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { RootStackParamList } from '../types/navigation';
import { useLocale } from '../i18n/LocaleContext';

type Nav = StackNavigationProp<RootStackParamList, 'PickerHome'>;

const HEADER_ACCENT = '#1a237e';
const CARD_BG = '#f0f0f0';
const TEXT_PRIMARY = '#333';
const TEXT_SECONDARY = '#777';
const BOTTOM_ACTIVE = '#1a237e';
const BOTTOM_INACTIVE = '#666';
const SCAN_BTN = '#1976d2';
const CARD_ICON_SIZE = 24;
const TAB_ICON_SIZE = 24;

function Card({
  iconName,
  title,
  subtitle,
  onPress,
}: {
  iconName: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.cardIcon}>
        <Icon name={iconName as any} size={CARD_ICON_SIZE} color={TEXT_PRIMARY} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSubtitle}>{subtitle}</Text>
      </View>
      <Icon name="chevron-right" size={24} color={TEXT_SECONDARY} />
    </TouchableOpacity>
  );
}

function BottomNavTab({
  iconName,
  label,
  active,
  onPress,
}: {
  iconName: string;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const color = active ? BOTTOM_ACTIVE : BOTTOM_INACTIVE;
  return (
    <TouchableOpacity style={styles.tab} onPress={onPress} activeOpacity={0.7}>
      <Icon name={iconName as any} size={TAB_ICON_SIZE} color={color} style={styles.tabIcon} />
      <Text
        style={[styles.tabLabel, { color }]}
        numberOfLines={1}
        ellipsizeMode="tail"
        allowFontScaling={false}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export function PickerHome() {
  const navigation = useNavigation<Nav>();
  const { t } = useLocale();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Image
          source={require('../assets/logo.png')}
          style={styles.headerLogo}
          resizeMode="contain"
        />
        <Text style={styles.headerTitle}>{t('pickerTitle')}</Text>
      </View>

      {/* Cards */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
      >
        <Card
          iconName="clipboard-list-outline"
          title={t('myPickTasks')}
          subtitle={t('docsForPicking')}
          onPress={() => navigation.navigate('PickTaskList')}
        />
        <Card
          iconName="package-variant"
          title={t('inventory')}
          subtitle={t('productsAndLocations')}
          onPress={() => navigation.navigate('Inventory')}
        />
        <Card
          iconName="sync-off"
          title={t('offlineQueue')}
          subtitle={t('syncPending')}
          onPress={() => {}}
        />
      </ScrollView>

      {/* Bottom nav */}
      <View style={styles.bottomNav}>
        <BottomNavTab
          iconName="home"
          label={t('tabMain')}
          active={true}
          onPress={() => {}}
        />
        <BottomNavTab
          iconName="clipboard-list-outline"
          label={t('tabPickLists')}
          active={false}
          onPress={() => navigation.navigate('PickTaskList')}
        />
        <View style={styles.scanBtnWrap}>
          <TouchableOpacity
            style={styles.scanBtn}
            onPress={() => navigation.navigate('Scanner')}
            activeOpacity={0.8}
          >
            <Icon name="barcode-scan" size={34} color="#fff" />
          </TouchableOpacity>
        </View>
        <BottomNavTab
          iconName="package-variant"
          label={t('tabInventory')}
          active={false}
          onPress={() => navigation.navigate('Inventory')}
        />
        <BottomNavTab
          iconName="account-outline"
          label={t('tabAccount')}
          active={false}
          onPress={() => navigation.navigate('Hisob')}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  headerLogo: {
    width: 36,
    height: 36,
    borderRadius: 8,
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 24,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD_BG,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#e0e0e0',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  cardBody: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT_PRIMARY,
    marginBottom: 2,
  },
  cardSubtitle: {
    fontSize: 13,
    color: TEXT_SECONDARY,
  },
  bottomNav: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
    paddingTop: 12,
    paddingBottom: 24,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e0e0e0',
  },
  tab: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 4,
    paddingHorizontal: 2,
  },
  tabIcon: {
    marginBottom: 4,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '500',
    textAlign: 'center',
  },
  scanBtnWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 0,
  },
  scanBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: SCAN_BTN,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: -8,
    transform: [{ translateY: -20 }],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 8,
  },
});
