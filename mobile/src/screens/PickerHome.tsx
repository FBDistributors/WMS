/**
 * Yig'uvchi sahifasi — header, offline banner, 3 ta karta, pastki nav.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
  Platform,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import RNExitApp from 'react-native-exit-app';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { RootStackParamList } from '../types/navigation';
import { useLocale } from '../i18n/LocaleContext';
import { useTheme } from '../theme/ThemeContext';
import { useNetwork } from '../network';
import { getOpenTasks, getMyPickerStats, type MyPickerStats } from '../api/picking';
import { getCachedPickTasks } from '../offline/offlineDb';
import { getPendingCount } from '../offline/offlineQueue';
import { registerPushToken } from '../notifications/pushNotifications';
import { AppHeader } from '../components/AppHeader';
import { PickerFooter } from '../components/PickerFooter';
import { useTaskCount } from '../context/TaskCountContext';

type Nav = StackNavigationProp<RootStackParamList, 'PickerHome'>;
type PickerHomeRoute = RouteProp<RootStackParamList, 'PickerHome'>;

const HEADER_ACCENT = '#1a237e';
const CARD_BG = '#f0f0f0';
const TEXT_PRIMARY = '#333';
const TEXT_SECONDARY = '#777';
const CARD_ICON_SIZE = 24;
const BADGE_BG = '#e53935';

function Card({
  iconName,
  title,
  subtitle,
  onPress,
  badge,
  isDark,
}: {
  iconName: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  badge?: number;
  isDark?: boolean;
}) {
  const iconColor = isDark ? '#e2e8f0' : TEXT_PRIMARY;
  return (
    <TouchableOpacity style={[styles.card, isDark && styles.cardDark]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.cardIconWrap}>
        <View style={[styles.cardIcon, isDark && styles.cardIconDark]}>
          <Icon name={iconName as any} size={CARD_ICON_SIZE} color={iconColor} />
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
        <Text style={[styles.cardTitle, isDark && styles.cardTitleDark]}>{title}</Text>
        <Text style={[styles.cardSubtitle, isDark && styles.cardSubtitleDark]}>{subtitle}</Text>
      </View>
      <Icon name="chevron-right" size={24} color={isDark ? '#94a3b8' : TEXT_SECONDARY} />
    </TouchableOpacity>
  );
}

export function PickerHome() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<PickerHomeRoute>();
  const { t } = useLocale();
  const { theme } = useTheme();
  const { setTaskCount } = useTaskCount();
  const { isOnline } = useNetwork();
  const [queueCount, setQueueCount] = useState(0);
  const [stats, setStats] = useState<MyPickerStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const profileType = route.params?.profileType ?? 'picker';
  const headerTitle = profileType === 'controller' ? t('controllerTitle') : t('pickerTitle');
  const isDark = theme === 'dark';

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
  }, [isOnline, setTaskCount]);

  useEffect(() => {
    registerPushToken();
  }, []);

  useFocusEffect(useCallback(() => { refreshCounts(); }, [refreshCounts]));

  useFocusEffect(
    useCallback(() => {
      const onBack = () => {
        if (Platform.OS === 'android') {
          RNExitApp.exitApp();
        }
        return true;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => sub.remove();
    }, [])
  );

  const onHeaderRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshCounts();
    setRefreshing(false);
  }, [refreshCounts]);

  const swipeToOrders = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 20 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderRelease: (_, g) => {
          if (g.dx < -60 || g.vx < -0.2) {
            navigation.navigate('PickTaskList', { profileType });
          }
        },
      }),
    [navigation, profileType]
  );

  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]} edges={['top']}>
      {/* Header */}
      <AppHeader
        title={headerTitle}
        showLogo={true}
        onRefresh={onHeaderRefresh}
        refreshing={refreshing}
        headerStyle={isDark ? styles.headerDark : undefined}
        titleStyle={isDark ? styles.headerTitleDark : undefined}
        accentColor={isDark ? '#93c5fd' : undefined}
        leftTrailing={
          <TouchableOpacity
            onPress={() => navigation.navigate('Hisob')}
            style={styles.headerHisobBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel={t('tabAccount')}
          >
            <Icon name="account-outline" size={24} color={isDark ? '#93c5fd' : HEADER_ACCENT} />
          </TouchableOpacity>
        }
        rightTrailing={!isOnline ? (
          <View style={[styles.onlineBadge, isDark && styles.onlineBadgeDark]}>
            <Text style={styles.onlineBadgeText}>Offline</Text>
          </View>
        ) : undefined}
      />

      {!isOnline && (
        <View style={[styles.offlineBanner, isDark && styles.offlineBannerDark]}>
          <Text style={[styles.offlineBannerText, isDark && styles.offlineBannerTextDark]}>
            {t('offlineBanner', { count: queueCount })}
          </Text>
        </View>
      )}

      {/* Stats + Chart, then Offline queue card — yon siljish bilan Buyurtmalarga o'tish */}
      <View style={styles.scrollWrap} {...swipeToOrders.panHandlers}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
      >
        {stats !== null && (
          <View style={[styles.statsSection, isDark && styles.statsSectionDark]}>
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={[styles.statValue, isDark && styles.statValueDark]}>{stats.total_completed}</Text>
                <Text style={[styles.statLabel, isDark && styles.statLabelDark]}>{t('statsTotalCompleted')}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statValue, isDark && styles.statValueDark]}>{stats.completed_today}</Text>
                <Text style={[styles.statLabel, isDark && styles.statLabelDark]}>{t('statsCompletedToday')}</Text>
              </View>
            </View>
            {stats.by_day.length > 0 && (
              <View style={[styles.chartWrap, isDark && styles.chartWrapDark]}>
                <Text style={[styles.chartTitle, isDark && styles.chartTitleDark]}>{t('statsChartTitle')}</Text>
                <View style={styles.chartBarRow}>
                  {stats.by_day.map((d) => {
                    const maxC = Math.max(1, ...stats.by_day.map((x) => x.count));
                    const h = maxC > 0 ? Math.max(4, (d.count / maxC) * 80) : 4;
                    const label = d.date.slice(8, 10);
                    return (
                      <View key={d.date} style={styles.chartBarCol}>
                        <View style={[styles.chartBar, isDark && styles.chartBarDark, { height: h }]} />
                        <Text style={[styles.chartBarLabel, isDark && styles.chartBarLabelDark]} numberOfLines={1}>{label}</Text>
                        {d.count > 0 && (
                          <Text style={[styles.chartBarCount, isDark && styles.chartBarCountDark]}>{d.count}</Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
          </View>
        )}
        {profileType === 'picker' && (
          <Card
            iconName="format-list-group"
            title={t('consolidatedPickTitle')}
            subtitle={t('consolidatedMyTasks')}
            onPress={() => navigation.navigate('ConsolidatedPick')}
            isDark={isDark}
          />
        )}
        <Card
          iconName="sync-off"
          title={queueCount > 0 ? `${t('offlineQueue')} (${queueCount})` : t('offlineQueue')}
          subtitle={t('syncPending')}
          onPress={() => navigation.navigate('QueueScreen')}
          isDark={isDark}
        />
      </ScrollView>
      </View>

      <PickerFooter currentRoute="PickerHome" profileType={profileType} />
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
  scrollWrap: { flex: 1 },
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
  // Dark theme (Yig'uvchi)
  containerDark: { backgroundColor: '#0f172a' },
  headerDark: {
    backgroundColor: '#1e293b',
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerTitleDark: { color: '#f1f5f9' },
  onlineBadgeDark: { backgroundColor: '#b45309' },
  offlineBannerDark: {
    backgroundColor: 'rgba(251,191,36,0.2)',
    borderBottomColor: 'rgba(251,191,36,0.3)',
  },
  offlineBannerTextDark: { color: '#fcd34d' },
  statsSectionDark: { backgroundColor: '#1e293b' },
  statValueDark: { color: '#93c5fd' },
  statLabelDark: { color: '#94a3b8' },
  chartWrapDark: { borderTopColor: 'rgba(255,255,255,0.08)' },
  chartTitleDark: { color: '#94a3b8' },
  chartBarDark: { backgroundColor: '#60a5fa' },
  chartBarLabelDark: { color: '#94a3b8' },
  chartBarCountDark: { color: '#e2e8f0' },
  cardDark: { backgroundColor: '#1e293b' },
  cardIconDark: { backgroundColor: '#334155' },
  cardTitleDark: { color: '#f1f5f9' },
  cardSubtitleDark: { color: '#94a3b8' },
});
