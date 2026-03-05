/**
 * Hisob sahifasi — profile uslubida: ism familya, login, til qatorlari.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  StyleSheet,
  Text,
  TextInput,
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
import { useTheme, type ThemeType } from '../theme/ThemeContext';
import apiClient from '../api/client';
import { logout, changePassword, updateMe } from '../api/auth';

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
  hideRight,
  isDark,
}: {
  icon: string;
  label: string;
  value: string;
  onPress?: () => void;
  hideRight?: boolean;
  isDark?: boolean;
}) {
  const iconWrapStyle = isDark ? [styles.rowIconWrap, styles.rowIconWrapDark] : styles.rowIconWrap;
  const labelStyle = isDark ? [styles.rowLabel, styles.rowLabelDark] : styles.rowLabel;
  const valueStyle = isDark ? [styles.rowValue, styles.rowValueDark] : styles.rowValue;
  const content = (
    <>
      <View style={styles.rowLeft}>
        <View style={iconWrapStyle}>
          <Icon name={icon as any} size={20} color={isDark ? '#93c5fd' : '#1976d2'} />
        </View>
        <Text style={labelStyle}>{label}</Text>
      </View>
      {!hideRight && (
        <View style={styles.rowRight}>
          <Text style={valueStyle} numberOfLines={1}>
            {value || '—'}
          </Text>
          {onPress ? (
            <Icon name="chevron-right" size={20} color={isDark ? '#94a3b8' : '#999'} style={styles.rowChevron} />
          ) : null}
        </View>
      )}
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
  const { theme, setTheme } = useTheme();
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

  const [languageModalVisible, setLanguageModalVisible] = useState(false);
  const handleLanguagePress = () => setLanguageModalVisible(true);
  const handleCloseLanguageModal = () => setLanguageModalVisible(false);
  const handleSelectLocale = (code: LocaleCode) => {
    setLocale(code);
    setLanguageModalVisible(false);
  };
  const [themeModalVisible, setThemeModalVisible] = useState(false);
  const handleThemePress = () => setThemeModalVisible(true);
  const handleCloseThemeModal = () => setThemeModalVisible(false);
  const handleSelectTheme = (value: ThemeType) => {
    setTheme(value);
    setThemeModalVisible(false);
  };
  const themeLabel = theme === 'dark' ? t('theme_dark') : t('theme_light');

  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [usernameModalVisible, setUsernameModalVisible] = useState(false);
  const [newUsername, setNewUsername] = useState(user?.username ?? '');
  const [usernameLoading, setUsernameLoading] = useState(false);

  useEffect(() => {
    if (user) setNewUsername(user.username);
  }, [user?.username]);

  const openPasswordModal = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordModalVisible(true);
  };
  const openUsernameModal = () => {
    setNewUsername(user?.username ?? '');
    setUsernameModalVisible(true);
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      Alert.alert(t('error'), t('passwordMismatch'));
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert(t('error'), t('errorPasswordShort'));
      return;
    }
    if (!currentPassword.trim()) {
      Alert.alert(t('error'), t('errorInvalidCurrent'));
      return;
    }
    setPasswordLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordModalVisible(false);
      Alert.alert('', t('passwordUpdated'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('errorInvalidCurrent');
      Alert.alert(t('error'), msg);
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleChangeUsername = async () => {
    const trimmed = newUsername.trim();
    if (trimmed.length < 3) {
      Alert.alert(t('error'), t('errorUsernameShort'));
      return;
    }
    if (trimmed === user?.username) {
      setUsernameModalVisible(false);
      return;
    }
    setUsernameLoading(true);
    try {
      const updated = await updateMe({ username: trimmed });
      setUser(updated);
      setUsernameModalVisible(false);
      Alert.alert('', t('usernameUpdated'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('error');
      const isTaken = typeof msg === 'string' && (msg.includes('exists') || msg.includes('taken') || msg.includes('band'));
      Alert.alert(t('error'), isTaken ? t('errorUsernameTaken') : msg);
    } finally {
      setUsernameLoading(false);
    }
  };

  const isDark = theme === 'dark';
  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]} edges={['top']}>
      <View style={[styles.header, isDark && styles.headerDark]}>
        <TouchableOpacity
          style={[styles.backButton, isDark && styles.backButtonDark]}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Icon name="arrow-left" size={24} color={isDark ? '#93c5fd' : '#1976d2'} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, isDark && styles.headerTitleDark]}>{t('account')}</Text>
      </View>

      {loading ? (
        <View style={[styles.centered, isDark && styles.centeredDark]}>
          <ActivityIndicator size="large" color={isDark ? '#93c5fd' : '#1976d2'} />
        </View>
      ) : error ? (
        <View style={[styles.centered, isDark && styles.centeredDark]}>
          <Text style={[styles.errorText, isDark && styles.errorTextDark]}>{t(error)}</Text>
        </View>
      ) : user ? (
        <View style={styles.content}>
          <TouchableOpacity
            style={styles.avatarWrap}
            onPress={handleAvatarPress}
            activeOpacity={0.8}
          >
            <View style={[styles.avatarCircle, isDark && styles.avatarCircleDark]}>
              {profilePhoto ? (
                <Image
                  source={{ uri: profilePhoto }}
                  style={styles.avatarImage}
                  resizeMode="cover"
                />
              ) : (
                <Icon name="camera-plus-outline" size={40} color={isDark ? '#94a3b8' : '#999'} />
              )}
            </View>
          </TouchableOpacity>
          <View style={[styles.card, isDark && styles.cardDark]}>
            <ProfileRow
              icon="account-outline"
              label={t('profileName')}
              value={user.full_name ?? ''}
              isDark={isDark}
            />
            <View style={[styles.separator, isDark && styles.separatorDark]} />
            <ProfileRow
              icon="account-circle-outline"
              label={t('profileLogin')}
              value={user.username}
              isDark={isDark}
            />
            <View style={[styles.separator, isDark && styles.separatorDark]} />
            <ProfileRow
              icon="lock-outline"
              label={t('profileChangePassword')}
              value=""
              onPress={openPasswordModal}
              hideRight
              isDark={isDark}
            />
            <View style={[styles.separator, isDark && styles.separatorDark]} />
            <ProfileRow
              icon="pencil-outline"
              label={t('profileChangeUsername')}
              value=""
              onPress={openUsernameModal}
              hideRight
              isDark={isDark}
            />
            <View style={[styles.separator, isDark && styles.separatorDark]} />
            <ProfileRow
              icon="translate"
              label={t('language')}
              value={localeLabels[locale]}
              onPress={handleLanguagePress}
              isDark={isDark}
            />
            <View style={[styles.separator, isDark && styles.separatorDark]} />
            <ProfileRow
              icon="theme-light-dark"
              label={t('theme_label')}
              value={themeLabel}
              onPress={handleThemePress}
              isDark={isDark}
            />
          </View>

          <TouchableOpacity style={[styles.logoutBtn, isDark && styles.logoutBtnDark]} onPress={handleLogout} activeOpacity={0.8}>
            <Icon name="logout" size={22} color="#f87171" />
            <Text style={styles.logoutText}>{t('logoutButton')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Modal
        visible={languageModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCloseLanguageModal}
      >
        <TouchableOpacity
          style={styles.languageModalOverlay}
          activeOpacity={1}
          onPress={handleCloseLanguageModal}
        >
          <View style={styles.languageModalContent} onStartShouldSetResponder={() => true}>
            <View style={styles.languageModalHeader}>
              <Text style={styles.languageModalTitle}>{t('language')}</Text>
              <TouchableOpacity
                onPress={handleCloseLanguageModal}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={styles.languageModalCloseBtn}
              >
                <Icon name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            {LOCALES.map((code) => (
              <TouchableOpacity
                key={code}
                style={styles.languageModalOption}
                onPress={() => handleSelectLocale(code)}
                activeOpacity={0.7}
              >
                <Text style={styles.languageModalOptionText}>{localeLabels[code]}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={themeModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCloseThemeModal}
      >
        <TouchableOpacity
          style={styles.languageModalOverlay}
          activeOpacity={1}
          onPress={handleCloseThemeModal}
        >
          <View style={[styles.languageModalContent, theme === 'dark' && styles.themeModalContentDark]} onStartShouldSetResponder={() => true}>
            <View style={[styles.languageModalHeader, theme === 'dark' && styles.themeModalHeaderDark]}>
              <Text style={[styles.languageModalTitle, theme === 'dark' && styles.themeModalTextDark]}>{t('theme_label')}</Text>
              <TouchableOpacity
                onPress={handleCloseThemeModal}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={styles.languageModalCloseBtn}
              >
                <Icon name="close" size={24} color={theme === 'dark' ? '#f1f5f9' : '#333'} />
              </TouchableOpacity>
            </View>
            {(['light', 'dark'] as const).map((value) => (
              <TouchableOpacity
                key={value}
                style={[styles.languageModalOption, theme === 'dark' && styles.themeModalOptionDark]}
                onPress={() => handleSelectTheme(value)}
                activeOpacity={0.7}
              >
                <Text style={[styles.languageModalOptionText, theme === 'dark' && styles.themeModalTextDark]}>
                  {value === 'light' ? t('theme_light') : t('theme_dark')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={passwordModalVisible} transparent animationType="fade">
        <TouchableOpacity
          style={styles.languageModalOverlay}
          activeOpacity={1}
          onPress={() => !passwordLoading && setPasswordModalVisible(false)}
        >
          <View style={styles.formModalContent} onStartShouldSetResponder={() => true}>
            <View style={styles.languageModalHeader}>
              <Text style={styles.languageModalTitle}>{t('profileChangePassword')}</Text>
              <TouchableOpacity
                onPress={() => !passwordLoading && setPasswordModalVisible(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={styles.languageModalCloseBtn}
              >
                <Icon name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.formInput}
              placeholder={t('currentPassword')}
              placeholderTextColor="#666"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              autoCapitalize="none"
              editable={!passwordLoading}
            />
            <TextInput
              style={styles.formInput}
              placeholder={t('newPassword')}
              placeholderTextColor="#666"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoCapitalize="none"
              editable={!passwordLoading}
            />
            <TextInput
              style={styles.formInput}
              placeholder={t('confirmPassword')}
              placeholderTextColor="#666"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              editable={!passwordLoading}
            />
            <TouchableOpacity
              style={[styles.formSubmitBtn, passwordLoading && styles.formSubmitBtnDisabled]}
              onPress={handleChangePassword}
              disabled={passwordLoading}
              activeOpacity={0.8}
            >
              <Text style={styles.formSubmitText}>
                {passwordLoading ? '…' : t('save')}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={usernameModalVisible} transparent animationType="fade">
        <TouchableOpacity
          style={styles.languageModalOverlay}
          activeOpacity={1}
          onPress={() => !usernameLoading && setUsernameModalVisible(false)}
        >
          <View style={styles.formModalContent} onStartShouldSetResponder={() => true}>
            <View style={styles.languageModalHeader}>
              <Text style={styles.languageModalTitle}>{t('profileChangeUsername')}</Text>
              <TouchableOpacity
                onPress={() => !usernameLoading && setUsernameModalVisible(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={styles.languageModalCloseBtn}
              >
                <Icon name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.formInput}
              placeholder={t('profileLogin')}
              placeholderTextColor="#666"
              value={newUsername}
              onChangeText={setNewUsername}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!usernameLoading}
            />
            <TouchableOpacity
              style={[styles.formSubmitBtn, usernameLoading && styles.formSubmitBtnDisabled]}
              onPress={handleChangeUsername}
              disabled={usernameLoading}
              activeOpacity={0.8}
            >
              <Text style={styles.formSubmitText}>
                {usernameLoading ? '…' : t('save')}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
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
  languageModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  languageModalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingBottom: 16,
    minWidth: 280,
    maxWidth: 320,
  },
  languageModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  languageModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
  },
  languageModalCloseBtn: {
    padding: 4,
  },
  languageModalOption: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  languageModalOptionText: {
    fontSize: 16,
    color: '#1976d2',
    fontWeight: '500',
  },
  // Dark theme (AccountScreen)
  containerDark: {
    backgroundColor: '#0f172a',
  },
  headerDark: {
    backgroundColor: '#1e293b',
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerTitleDark: {
    color: '#f1f5f9',
  },
  backButtonDark: {
    backgroundColor: 'rgba(148,163,184,0.2)',
  },
  centeredDark: {
    backgroundColor: '#0f172a',
  },
  errorTextDark: {
    color: '#94a3b8',
  },
  avatarCircleDark: {
    backgroundColor: '#334155',
    borderColor: '#1e293b',
  },
  cardDark: {
    backgroundColor: '#1e293b',
    borderColor: 'rgba(255,255,255,0.08)',
  },
  separatorDark: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  rowIconWrapDark: {
    backgroundColor: 'rgba(59,130,246,0.2)',
  },
  rowLabelDark: {
    color: '#94a3b8',
  },
  rowValueDark: {
    color: '#f1f5f9',
  },
  logoutBtnDark: {
    backgroundColor: '#1e293b',
    borderColor: 'rgba(248,113,113,0.4)',
  },
  themeModalContentDark: {
    backgroundColor: '#1e293b',
  },
  themeModalHeaderDark: {
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  themeModalOptionDark: {
    backgroundColor: 'transparent',
  },
  themeModalTextDark: {
    color: '#f1f5f9',
  },
  formModalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    paddingBottom: 20,
    minWidth: 280,
    maxWidth: 320,
  },
  formInput: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111',
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  formSubmitBtn: {
    backgroundColor: '#1976d2',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  formSubmitBtnDisabled: {
    opacity: 0.6,
  },
  formSubmitText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
