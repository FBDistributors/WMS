/**
 * Umumiy header: orqaga, logo, sarlavha, yuqori o'ngda refresh tugmasi.
 * Obnavit va boshqa harakatlar uchun onRefresh beriladi.
 */
import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { BRAND } from '../config/branding';

const HEADER_ACCENT = '#1a237e';

export type AppHeaderProps = {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  showLogo?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Chap tomonda (logo/back dan oldin) */
  leftTrailing?: React.ReactNode;
  /** O'ng tomonda refresh dan oldin (masalan offline badge) */
  rightTrailing?: React.ReactNode;
  /** Dark mavzu: header va matn stillari */
  headerStyle?: object;
  titleStyle?: object;
  accentColor?: string;
};

export function AppHeader({
  title,
  showBack = false,
  onBack,
  showLogo = true,
  onRefresh,
  refreshing = false,
  leftTrailing,
  rightTrailing,
  headerStyle,
  titleStyle,
  accentColor = HEADER_ACCENT,
}: AppHeaderProps) {
  const accent = accentColor ?? HEADER_ACCENT;
  return (
    <View style={[styles.header, headerStyle]}>
      {leftTrailing}
      {showBack && (
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Orqaga"
        >
          <Icon name="arrow-left" size={24} color={accent} />
        </TouchableOpacity>
      )}
      {showLogo && (
        <Image
          source={require('../assets/logo.png')}
          style={[styles.headerLogo, { width: BRAND.headerLogoSize, height: BRAND.headerLogoSize }]}
          resizeMode="contain"
        />
      )}
      <Text style={[styles.headerTitle, titleStyle]} numberOfLines={1}>
        {title}
      </Text>
      {rightTrailing}
      {onRefresh != null && (
        <TouchableOpacity
          onPress={onRefresh}
          style={styles.refreshBtn}
          disabled={refreshing}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Yangilash"
        >
          <Icon
            name="refresh"
            size={24}
            color={refreshing ? '#94a3b8' : accent}
          />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  backBtn: {
    marginRight: 12,
  },
  headerLogo: {
    borderRadius: 8,
    marginRight: 12,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
  },
  refreshBtn: {
    padding: 4,
    marginLeft: 4,
  },
});
