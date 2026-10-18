'use client';

import React, { createContext, useCallback, useEffect, useState } from 'react';
import { message } from 'antd';

export const AuthContext = createContext({
  license: null,
  loading: true,
  messageApi: null,
  redeemLicense: async () => ({ active: false }),
  refreshLicense: async () => ({ active: false }),
  logout: async () => ({ active: false }),
});

export default function AuthContextProvider({ children }) {
  const [messageApi, ContextHolder] = message.useMessage();
  const [license, setLicense] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshLicense = useCallback(async () => {
    try {
      const result = await window.desktopLicense?.getStatus?.();
      setLicense(result?.active ? (result.license || null) : null);
      return result || { active: false };
    } catch (error) {
      setLicense(null);
      return { active: false, error: error.message || 'Unable to check license.' };
    } finally {
      setLoading(false);
    }
  }, []);

  const redeemLicense = useCallback(async (key, username) => {
    try {
      const result = await window.desktopLicense?.redeem?.(key, username);
      setLicense(result?.active ? (result.license || null) : null);
      return result || { active: false, error: 'Desktop license bridge is unavailable.' };
    } catch (error) {
      return { active: false, error: error.message || 'Activation failed.' };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      const result = await window.desktopLicense?.clear?.();
      setLicense(null);
      return result || { active: false };
    } catch (error) {
      return { active: false, error: error.message || 'Could not clear local license.' };
    }
  }, []);

  useEffect(() => {
    let unsubscribe;
    refreshLicense();
    if (window.desktopLicense?.onStatusChanged) {
      unsubscribe = window.desktopLicense.onStatusChanged((status) => {
        setLicense(status?.active ? (status.license || null) : null);
      });
    }
    return () => unsubscribe?.();
  }, [refreshLicense]);

  return (
    <AuthContext.Provider value={{
      license, loading, messageApi, redeemLicense, refreshLicense, logout,
    }}>
      {ContextHolder}
      {children}
    </AuthContext.Provider>
  );
}
