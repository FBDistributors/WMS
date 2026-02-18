/**
 * Global network status: NetInfo + React context.
 * UI: header indicator, offline banner "Offline. Navbatda: X ta".
 * Auto-sync when coming online.
 */
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { queueGetPendingCount } from '../offline/offlineQueue';
import { syncPendingQueue } from '../offline/syncEngine';

type NetworkContextValue = {
  isOnline: boolean;
  isInitialized: boolean;
};

const NetworkContext = createContext<NetworkContextValue | null>(null);

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const online = state.isConnected ?? false;
      const wasOffline = wasOfflineRef.current;
      setIsOnline(online);
      setIsInitialized(true);
      if (online && wasOffline) {
        queueGetPendingCount()
          .then((count) => {
            if (count > 0) syncPendingQueue().catch(() => {});
          })
          .catch(() => {});
      }
      wasOfflineRef.current = !online;
    });
    NetInfo.fetch().then((state) => {
      const online = state.isConnected ?? false;
      setIsOnline(online);
      setIsInitialized(true);
      wasOfflineRef.current = !online;
    });
    return () => unsubscribe();
  }, []);

  const value: NetworkContextValue = {
    isOnline: isOnline ?? true,
    isInitialized,
  };

  return (
    <NetworkContext.Provider value={value}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error('useNetwork must be used inside NetworkProvider');
  return ctx;
}
