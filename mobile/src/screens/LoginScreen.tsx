import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { RootStackParamList } from '../types/navigation';
import type { LocaleCode } from '../i18n/translations';
import { useLocale } from '../i18n/LocaleContext';
import { localeLabels } from '../i18n/translations';
import { getStoredToken } from '../api/client';
import { login } from '../api/auth';
import { BRAND } from '../config/branding';

type Nav = StackNavigationProp<RootStackParamList, 'Login'>;

const LOCALES: LocaleCode[] = ['uz', 'ru', 'en'];

export function LoginScreen() {
  const navigation = useNavigation<Nav>();
  const { t, locale, setLocale } = useLocale();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    getStoredToken().then((token) => {
      if (token) navigation.replace('PickerHome');
    });
  }, [navigation]);

  const handleLogin = async () => {
    const u = username.trim();
    const p = password.trim();
    if (!u || !p) {
      Alert.alert(t('error'), t('enterLoginPassword'));
      return;
    }
    setLoading(true);
    try {
      await login({ username: u, password: p });
      navigation.replace('PickerHome');
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('loginError');
      Alert.alert(t('error'), msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {dropdownOpen && (
        <Pressable style={styles.dropdownBackdrop} onPress={() => setDropdownOpen(false)} />
      )}
      <View style={styles.langDropdownWrap}>
        <TouchableOpacity
          style={styles.langTrigger}
          onPress={() => setDropdownOpen((v) => !v)}
          activeOpacity={0.8}
        >
          <Text style={styles.langTriggerText}>{localeLabels[locale]}</Text>
          <Icon name={dropdownOpen ? 'chevron-up' : 'chevron-down'} size={20} color="#555" />
        </TouchableOpacity>
        {dropdownOpen && (
          <View style={styles.dropdown}>
            {LOCALES.map((code, index) => (
              <TouchableOpacity
                key={code}
                style={[
                  styles.dropdownItem,
                  locale === code && styles.dropdownItemActive,
                  index === LOCALES.length - 1 && styles.dropdownItemLast,
                ]}
                onPress={() => {
                  setLocale(code);
                  setDropdownOpen(false);
                }}
              >
                <Text style={[styles.dropdownItemText, locale === code && styles.dropdownItemTextActive]}>
                  {localeLabels[code]}
                </Text>
                {locale === code && <Icon name="check" size={18} color="#1976d2" />}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
      <View style={styles.formWrap}>
      <Image source={require('../assets/logo.png')} style={[styles.logo, { width: BRAND.loginLogoSize, height: BRAND.loginLogoSize }]} resizeMode="contain" />
      <Text style={styles.brand}>{BRAND.name}</Text>
      <Text style={styles.subtitle}>{t('loginSubtitle')}</Text>
      <TextInput
        style={styles.input}
        value={username}
        onChangeText={setUsername}
        placeholder={t('loginPlaceholder')}
        placeholderTextColor="#999"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
      />
      <View style={styles.passwordWrap}>
        <TextInput
          style={styles.passwordInput}
          value={password}
          onChangeText={setPassword}
          placeholder={t('passwordPlaceholder')}
          placeholderTextColor="#999"
          secureTextEntry={!showPassword}
          editable={!loading}
        />
        <TouchableOpacity
          style={styles.passwordIcon}
          onPress={() => setShowPassword((v) => !v)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Icon
            name={showPassword ? 'eye-off-outline' : 'eye-outline'}
            size={22}
            color="#666"
          />
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={[styles.btn, loading && styles.btnDisabled]}
        onPress={handleLogin}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>{t('loginButton')}</Text>
        )}
      </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 48,
    backgroundColor: '#f5f5f5',
  },
  langDropdownWrap: {
    position: 'absolute',
    top: 48,
    right: 16,
    zIndex: 100,
  },
  langTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fff',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
    minWidth: 100,
  },
  langTriggerText: {
    fontSize: 14,
    color: '#111',
    fontWeight: '500',
  },
  dropdownBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99,
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 4,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
    minWidth: 120,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  dropdownItemActive: {
    backgroundColor: '#f0f7ff',
  },
  dropdownItemText: {
    fontSize: 15,
    color: '#111',
  },
  dropdownItemTextActive: {
    fontWeight: '600',
    color: '#1976d2',
  },
  dropdownItemLast: {
    borderBottomWidth: 0,
  },
  formWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  logo: {
    marginBottom: 12,
  },
  brand: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111',
    marginBottom: 4,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  subtitle: { fontSize: 16, color: '#666', marginBottom: 24 },
  input: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111',
    marginBottom: 12,
  },
  passwordWrap: {
    width: '100%',
    maxWidth: 320,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    marginBottom: 12,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111',
  },
  passwordIcon: {
    padding: 12,
  },
  btn: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#1976d2',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  btnDisabled: { opacity: 0.7 },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});
