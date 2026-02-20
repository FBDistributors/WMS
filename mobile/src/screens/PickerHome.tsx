/**
 * Yig'uvchi sahifasi — header, offline banner, 3 ta karta, pastki nav.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { RootStackParamList } from '../types/navigation';
import { useLocale } from '../i18n/LocaleContext';
import { useNetwork } from '../network';
import { getOpenTasks, getMyPickerStats, type MyPickerStats } from '../api/picking';
import { getCachedPickTasks } from '../offline/offlineDb';
import { getPendingCount } from '../offline/offlineQueue';
import { registerPushToken } from '../notifications/pushNotifications';
import { AppHeader } from '../components/AppHeader';

type Nav = StackNavigationProp<RootStackParamList, 'PickerHome'>;
type PickerHomeRoute = RouteProp<RootStackParamList, 'PickerHome'>;

const HEADER_ACCENT = '#1a237e';
const CARD_BG = '#f0f0f0';
const TEXT_PRIMARY = '#333';
const TEXT_SECONDARY = '#777';
const BOTTOM_ACTIVE = '#1a237e';
const BOTTOM_INACTIVE = '#666';
const SCAN_BTN = '#1976d2';
const CARD_ICON_SIZE = 24;
const TAB_ICON_SIZE = 24;
const BADGE_BG = '#e53935';

function Card({
  iconName,
  title,
  subtitle,
  onPress,
  badge,
}: {
  iconName: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  badge?: number;
}) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.cardIconWrap}>
        <View style={styles.cardIcon}>
          <Icon name={iconName as any} size={CARD_ICON_SIZE} color={TEXT_PRIMARY} />
        </View>
        {badge != null && badge > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText} numberOfLines={1}>
              {badge > 99 ? '99+' : String(badge)}
            </Text>
          </View>
        )}
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
  badge,
}: {
  iconName: string;
  label: string;
  active: boolean;
  onPress: () => void;
  badge?: number;
}) {
  const color = active ? BOTTOM_ACTIVE : BOTTOM_INACTIVE;
  return (
    <TouchableOpacity style={styles.tab} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.tabIconWrap}>
        <Icon name={iconName as any} size={TAB_ICON_SIZE} color={color} style={styles.tabIcon} />
        {badge != null && badge > 0 && (
          <View style={styles.tabBadge}>
            <Text style={styles.tabBadgeText} numberOfLines={1}>
              {badge > 99 ? '99+' : String(badge)}
            </Text>
          </View>
        )}
      </View>
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
  const route = useRoute<PickerHomeRoute>();
  const { t } = useLocale();
  const { isOnline } = useNetwork();
  const [queueCount, setQueueCount] = useState(0);
  const [taskCount, setTaskCount] = useState(0);
  const [stats, setStats] = useState<MyPickerStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const profileType = route.params?.profileType ?? 'picker';
  const headerTitle = profileType === 'controller' ? t('controllerTitle') : t('pickerTitle');

  const refreshCounts = useCallback(async () => {
    getPendingCount().then(setQueueCount);
    if (isOnline) {
      getOpenTasks(50, 0)
        .then((data) => setTaskCount(Array.isArray(data) ? data.length : 0))
        .catch(() => setTaskCount(0));
      getMyPickerStats(7).then(setStats).catch(() => setStats(null));
    } else {
      getCachedPickTasks()
        .then((data) => setTaskCount(Array.isArray(data) ? data.length : 0))
        .catch(() => setTaskCount(0));
      setStats(null);
    }
  }, [isOnline]);

  useEffect(() => {
    registerPushToken();
  }, []);

  useFocusEffect(useCallback(() => { refreshCounts(); }, [refreshCounts]));

  const onHeaderRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshCounts();
    setRefreshing(false);
  }, [refreshCounts]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <AppHeader
        title={headerTitle}
        showLogo={true}
        onRefresh={onHeaderRefresh}
        refreshing={refreshing}
        leftTrailing={
          <TouchableOpacity
            onPress={() => navigation.navigate('Hisob')}
            style={styles.headerHisobBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel={t('tabAccount')}
          >
            <Icon name="account-outline" size={24} color={HEADER_ACCENT} />
          </TouchableOpacity>
        }
        rightTrailing={!isOnline ? (
          <View style={styles.onlineBadge}>
            <Text style={styles.onlineBadgeText}>Offline</Text>
          </View>
        ) : undefined}
      />

      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>
            {t('offlineBanner', { count: queueCount })}
          </Text>
        </View>
      )}

      {/* Stats + Chart, then Offline queue card */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
      >
        {stats !== null && (
          <View style={styles.statsSection}>
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{stats.total_completed}</Text>
                <Text style={styles.statLabel}>{t('statsTotalCompleted')}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{stats.completed_today}</Text>
                <Text style={styles.statLabel}>{t('statsCompletedToday')}</Text>
              </View>
            </View>
            {stats.by_day.length > 0 && (
              <View style={styles.chartWrap}>
                <Text style={styles.chartTitle}>{t('statsChartTitle')}</Text>
                <View style={styles.chartBarRow}>
                  {stats.by_day.map((d) => {
                    const maxC = Math.max(1, ...stats.by_day.map((x) => x.count));
                    const h = maxC > 0 ? Math.max(4, (d.count / maxC) * 80) : 4;
                    const label = d.date.slice(8, 10);
                    return (
                      <View key={d.date} style={styles.chartBarCol}>
                        <View style={[styles.chartBar, { height: h }]} />
                        <Text style={styles.chartBarLabel} numberOfLines={1}>{label}</Text>
                        {d.count > 0 && (
                          <Text style={styles.chartBarCount}>{d.count}</Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
          </View>
        )}
        <Card
          iconName="sync-off"
          title={queueCount > 0 ? `${t('offlineQueue')} (${queueCount})` : t('offlineQueue')}
          subtitle={t('syncPending')}
          onPress={() => navigation.navigate('QueueScreen')}
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
          onPress={() => navigation.navigate('PickTaskList', { profileType })}
          badge={taskCount}
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
          iconName="package-down"
          label={t('tabKirim')}
          active={false}
          onPress={() => navigation.navigate('Kirim')}
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
  headerHisobBtn: {
    marginRight: 12,
  },
  onlineBadge: {
    backgroundColor: '#ff9800',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  onlineBadgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  offlineBanner: {
    backgroundColor: '#fff3e0',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#ffe0b2',
  },
  offlineBannerText: { fontSize: 14, color: '#e65100', fontWeight: '500', textAlign: 'center' },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 24,
  },
  statsSection: {
    marginBottom: 20,
    backgroundColor: CARD_BG,
    borderRadius: 12,
    padding: 16,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  statBox: {
    alignItems: 'center',
    minWidth: 100,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
    color: HEADER_ACCENT,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 13,
    color: TEXT_SECONDARY,
  },
  chartWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ddd',
    paddingTop: 12,
  },
  chartTitle: {
    fontSize: 13,
    color: TEXT_SECONDARY,
    marginBottom: 10,
    textAlign: 'center',
  },
  chartBarRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 100,
  },
  chartBarCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 2,
  },
  chartBar: {
    width: '80%',
    minHeight: 4,
    backgroundColor: HEADER_ACCENT,
    borderRadius: 4,
    marginBottom: 4,
  },
  chartBarLabel: {
    fontSize: 10,
    color: TEXT_SECONDARY,
  },
  chartBarCount: {
    fontSize: 10,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD_BG,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardIconWrap: {
    position: 'relative',
    marginRight: 14,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#e0e0e0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: BADGE_BG,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
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
  tabIconWrap: {
    position: 'relative',
    marginBottom: 4,
  },
  tabIcon: {},
  tabBadge: {
    position: 'absolute',
    top: -8,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: BADGE_BG,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
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
