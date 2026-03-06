/**
 * Pastki menyu — oddiy navbar, tablar va scan, bezaksiz.
 */
import React, { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';
import { useLocale } from '../i18n/LocaleContext';
import { useTheme } from '../theme/ThemeContext';
import { useTaskCount } from '../context/TaskCountContext';

const BOTTOM_ACTIVE = '#1a237e';
const BOTTOM_INACTIVE = '#666';
const TAB_ICON_SIZE = 24;
const BADGE_BG = '#e53935';

type Nav = StackNavigationProp<RootStackParamList, keyof RootStackParamList>;

function TabItem({
  iconName,
  label,
  active,
  onPress,
  badge,
  activeColor,
  inactiveColor,
}: {
  iconName: string;
  label: string;
  active: boolean;
  onPress: () => void;
  badge?: number;
  activeColor: string;
  inactiveColor: string;
}) {
  const color = active ? activeColor : inactiveColor;
  return (
    <TouchableOpacity style={footerStyles.tab} onPress={onPress} activeOpacity={0.7}>
      <View style={footerStyles.tabIconWrap}>
        <Icon name={iconName as any} size={TAB_ICON_SIZE} color={color} />
        {badge != null && badge > 0 && (
          <View style={footerStyles.tabBadge}>
            <Text style={footerStyles.tabBadgeText} numberOfLines={1}>
              {badge > 99 ? '99+' : String(badge)}
            </Text>
          </View>
        )}
      </View>
      <Text style={[footerStyles.tabLabel, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export type PickerFooterProps = {
  currentRoute: 'PickerHome' | 'PickTaskList' | 'Inventory' | 'Kirim' | 'Hisob';
  profileType?: 'picker' | 'controller';
};

function PickerFooterInner({ currentRoute, profileType = 'picker' }: PickerFooterProps) {
  const navigation = useNavigation<Nav>();
  const { t } = useLocale();
  const { theme } = useTheme();
  const { taskCount } = useTaskCount();
  const isDark = theme === 'dark';
  const navActiveColor = isDark ? '#93c5fd' : BOTTOM_ACTIVE;
  const navInactiveColor = isDark ? '#94a3b8' : BOTTOM_INACTIVE;
  const barBg = isDark ? '#1e293b' : '#fff';
  const borderColor = isDark ? '#334155' : '#e0e0e0';

  return (
    <View style={[footerStyles.footerBar, { backgroundColor: barBg, borderTopColor: borderColor }]}>
      <View style={footerStyles.row} pointerEvents="box-none">
        <TabItem
          iconName="home"
          label={t('tabMain')}
          active={currentRoute === 'PickerHome'}
          onPress={() => navigation.navigate('PickerHome', { profileType })}
          activeColor={navActiveColor}
          inactiveColor={navInactiveColor}
        />
        <TabItem
          iconName="clipboard-list-outline"
          label={t('tabPickLists')}
          active={currentRoute === 'PickTaskList'}
          onPress={() => navigation.navigate('PickTaskList', { profileType })}
          badge={taskCount}
          activeColor={navActiveColor}
          inactiveColor={navInactiveColor}
        />
        <View style={footerStyles.scanWrap}>
          <TouchableOpacity
            style={footerStyles.scanBtn}
            onPress={() => navigation.navigate('Scanner')}
            activeOpacity={0.8}
          >
            <Icon name="barcode-scan" size={32} color="#fff" />
          </TouchableOpacity>
        </View>
        <TabItem
          iconName="package-variant"
          label={t('tabInventory')}
          active={currentRoute === 'Inventory'}
          onPress={() => navigation.navigate('Inventory')}
          activeColor={navActiveColor}
          inactiveColor={navInactiveColor}
        />
        <TabItem
          iconName="package-down"
          label={t('tabKirim')}
          active={currentRoute === 'Kirim'}
          onPress={() => navigation.navigate('Kirim')}
          activeColor={navActiveColor}
          inactiveColor={navInactiveColor}
        />
      </View>
    </View>
  );
}

export const PickerFooter = memo(PickerFooterInner);

const footerStyles = StyleSheet.create({
  footerBar: {
    width: '100%',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e0e0e0',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  tab: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  tabIconWrap: { position: 'relative', marginBottom: 2 },
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
  tabBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  tabLabel: { fontSize: 10, fontWeight: '500', textAlign: 'center' },
  scanWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#1976d2',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateY: -14 }],
  },
});
