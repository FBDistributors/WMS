import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { useLocale } from '../i18n/LocaleContext';
import { getStoredToken } from '../api/client';
import { login } from '../api/auth';

type Nav = StackNavigationProp<RootStackParamList, 'Login'>;

export function LoginScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useLocale();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
      <Image source={require('../assets/logo.png')} style={styles.logo} resizeMode="contain" />
      <Text style={styles.brand}>{t('brand')}</Text>
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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#f5f5f5',
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 12,
  },
  brand: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111',
    marginBottom: 4,
    letterSpacing: 0.5,
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
