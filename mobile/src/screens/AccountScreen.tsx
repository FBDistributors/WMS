/**
 * Hisob sahifasi — foydalanuvchi, chiqish.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../types/navigation';
import { useLocale } from '../i18n/LocaleContext';
import { localeLabels, type LocaleCode } from '../i18n/translations';
import apiClient from '../api/client';
import { logout } from '../api/auth';

type Nav = StackNavigationProp<RootStackParamList, 'Hisob'>;

interface MeResponse {
  id: string;
  username: string;
  full_name: string | null;
  role: string;
  permissions: string[];
}

const LOCALES: LocaleCode[] = ['uz', 'ru', 'en'];

export function AccountScreen() {
  const navigation = useNavigation<Nav>();
  const { locale, setLocale, t } = useLocale();
  const [user, setUser] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<MeResponse>('/auth/me')
      .then(({ data }) => setUser(data))
      .catch(() => setError('accountLoadError'))
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = () => {
    Alert.alert(t('logout'), t('logoutConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('logoutButton'),
        style: 'destructive',
        onPress: async () => {
          await logout();
          navigation.reset({
            index: 0,
            routes: [{ name: 'Login' }],
          });
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow-left" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('account')}</Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#1976d2" />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{t(error)}</Text>
        </View>
      ) : user ? (
        <View style={styles.content}>
          <View style={styles.card}>
            <View style={styles.avatar}>
              <Icon name="account" size={40} color="#666" />
            </View>
            <Text style={styles.username}>{user.username}</Text>
            {user.full_name ? (
              <Text style={styles.fullName}>{user.full_name}</Text>
            ) : null}
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>{user.role}</Text>
            </View>
          </View>

          {/* Til tanlash */}
          <View style={styles.langSection}>
            <Text style={styles.langLabel}>{t('language')}</Text>
            <View style={styles.langRow}>
              {LOCALES.map((code) => (
                <TouchableOpacity
                  key={code}
                  style={[styles.langBtn, locale === code && styles.langBtnActive]}
                  onPress={() => setLocale(code)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.langBtnText,
                      locale === code && styles.langBtnTextActive,
                    ]}
                  >
                    {localeLabels[code]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
            <Icon name="logout" size={22} color="#c62828" />
            <Text style={styles.logoutText}>{t('logoutButton')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  backBtn: {
    padding: 8,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
    color: '#666',
  },
  content: {
    padding: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#eee',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  username: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  fullName: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  roleBadge: {
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1976d2',
  },
  langSection: {
    marginBottom: 20,
  },
  langLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 10,
  },
  langRow: {
    flexDirection: 'row',
    gap: 10,
  },
  langBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    alignItems: 'center',
  },
  langBtnActive: {
    borderColor: '#1976d2',
    backgroundColor: '#e3f2fd',
  },
  langBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  langBtnTextActive: {
    color: '#1976d2',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ffcdd2',
    gap: 8,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#c62828',
  },
});
