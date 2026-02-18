/**
 * Hisob sahifasi — profile uslubida: ism familya, login, til qatorlari.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../types/navigation';
import { useLocale } from '../i18n/LocaleContext';
import { localeLabels, type LocaleCode } from '../i18n/translations';
import apiClient from '../api/client';
import { logout } from '../api/auth';

const PROFILE_PHOTO_KEY = '@wms_profile_photo';
const IMAGE_OPTIONS = {
  mediaType: 'photo' as const,
  maxWidth: 400,
  maxHeight: 400,
  quality: 0.8,
  includeBase64: true as const,
};

type Nav = StackNavigationProp<RootStackParamList, 'Hisob'>;

interface MeResponse {
  id: string;
  username: string;
  full_name: string | null;
  role: string;
  permissions: string[];
}

const LOCALES: LocaleCode[] = ['uz', 'ru', 'en'];

function ProfileRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: string;
  label: string;
  value: string;
  onPress?: () => void;
}) {
  const content = (
    <>
      <View style={styles.rowLeft}>
        <View style={styles.rowIconWrap}>
          <Icon name={icon as any} size={20} color="#1976d2" />
        </View>
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.rowValue} numberOfLines={1}>
          {value || '—'}
        </Text>
        {onPress ? (
          <Icon name="chevron-right" size={20} color="#999" style={styles.rowChevron} />
        ) : null}
      </View>
    </>
  );
  if (onPress) {
    return (
      <TouchableOpacity style={styles.profileRow} onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }
  return <View style={styles.profileRow}>{content}</View>;
}

export function AccountScreen() {
  const navigation = useNavigation<Nav>();
  const { locale, setLocale, t } = useLocale();
  const [user, setUser] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<MeResponse>('/auth/me')
      .then(({ data }) => setUser(data))
      .catch(() => setError('accountLoadError'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(PROFILE_PHOTO_KEY).then((saved) => {
      if (saved) setProfilePhoto(saved);
    });
  }, []);

  const saveProfilePhoto = useCallback((uriOrBase64: string) => {
    setProfilePhoto(uriOrBase64);
    AsyncStorage.setItem(PROFILE_PHOTO_KEY, uriOrBase64);
  }, []);

  const handleAvatarPress = useCallback(() => {
    const buttons: Array<{ text: string; onPress?: () => void; style?: 'cancel' | 'destructive' }> = [
      { text: t('photoCamera'), onPress: () => openCamera() },
      { text: t('photoGallery'), onPress: () => openGallery() },
      { text: t('cancel'), style: 'cancel' },
    ];
    if (profilePhoto) {
      buttons.splice(2, 0, {
        text: t('photoRemove'),
        style: 'destructive',
        onPress: () => {
          setProfilePhoto(null);
          AsyncStorage.removeItem(PROFILE_PHOTO_KEY);
        },
      });
    }
    Alert.alert(t('profilePhoto'), undefined, buttons);
  }, [profilePhoto, t]);

  const openCamera = useCallback(() => {
    launchCamera(IMAGE_OPTIONS, (res) => {
      if (res.didCancel || res.errorCode || !res.assets?.[0]) return;
      const asset = res.assets[0];
      const uri = asset.base64
        ? `data:${asset.type ?? 'image/jpeg'};base64,${asset.base64}`
        : asset.uri;
      if (uri) saveProfilePhoto(uri);
    });
  }, [saveProfilePhoto]);

  const openGallery = useCallback(() => {
    launchImageLibrary(IMAGE_OPTIONS, (res) => {
      if (res.didCancel || res.errorCode || !res.assets?.[0]) return;
      const asset = res.assets[0];
      const uri = asset.base64
        ? `data:${asset.type ?? 'image/jpeg'};base64,${asset.base64}`
        : asset.uri;
      if (uri) saveProfilePhoto(uri);
    });
  }, [saveProfilePhoto]);

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

  const handleLanguagePress = () => {
    Alert.alert(t('language'), undefined, [
      ...LOCALES.map((code) => ({
        text: localeLabels[code],
        onPress: () => setLocale(code),
      })),
      { text: t('cancel'), style: 'cancel' as const },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Icon name="arrow-left" size={24} color="#1976d2" />
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
          <TouchableOpacity
            style={styles.avatarWrap}
            onPress={handleAvatarPress}
            activeOpacity={0.8}
          >
            <View style={styles.avatarCircle}>
              {profilePhoto ? (
                <Image
                  source={{ uri: profilePhoto }}
                  style={styles.avatarImage}
                  resizeMode="cover"
                />
              ) : (
                <Icon name="camera-plus-outline" size={40} color="#999" />
              )}
            </View>
          </TouchableOpacity>
          <View style={styles.card}>
            <ProfileRow
              icon="account-outline"
              label={t('profileName')}
              value={user.full_name ?? ''}
            />
            <View style={styles.separator} />
            <ProfileRow
              icon="account-circle-outline"
              label={t('profileLogin')}
              value={user.username}
            />
            <View style={styles.separator} />
            <ProfileRow
              icon="translate"
              label={t('language')}
              value={localeLabels[locale]}
              onPress={handleLanguagePress}
            />
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
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginRight: 8,
    borderRadius: 10,
    backgroundColor: '#f0f7ff',
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1976d2',
    marginLeft: 6,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
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
    padding: 16,
  },
  avatarWrap: {
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#e8e8e8',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  rowIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#f0f7ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowLabel: {
    fontSize: 15,
    color: '#666',
    fontWeight: '500',
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    marginLeft: 8,
  },
  rowValue: {
    fontSize: 15,
    color: '#111',
    fontWeight: '600',
    maxWidth: 160,
  },
  rowChevron: {
    marginLeft: 4,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#eee',
    marginLeft: 64,
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
