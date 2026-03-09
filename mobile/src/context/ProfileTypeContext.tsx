/**
 * Rol (picker/controller) — login dan keyin saqlanadi; navigatsiya va push da fallback.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const PROFILE_TYPE_KEY = '@wms_profile_type';

export type ProfileType = 'picker' | 'controller';

type ProfileTypeContextValue = {
  profileType: ProfileType;
  setProfileType: (v: ProfileType) => void;
};

const ProfileTypeContext = createContext<ProfileTypeContextValue | null>(null);

export function ProfileTypeProvider({ children }: { children: React.ReactNode }) {
  const [profileType, setProfileTypeState] = useState<ProfileType>('picker');

  const setProfileType = useCallback((v: ProfileType) => {
    setProfileTypeState(v);
    AsyncStorage.setItem(PROFILE_TYPE_KEY, v).catch(() => {});
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(PROFILE_TYPE_KEY)
      .then((stored) => {
        if (stored === 'picker' || stored === 'controller') {
          setProfileTypeState(stored);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <ProfileTypeContext.Provider value={{ profileType, setProfileType }}>
      {children}
    </ProfileTypeContext.Provider>
  );
}

export function useProfileType(): ProfileTypeContextValue {
  const ctx = useContext(ProfileTypeContext);
  if (!ctx) return { profileType: 'picker', setProfileType: () => {} };
  return ctx;
}
