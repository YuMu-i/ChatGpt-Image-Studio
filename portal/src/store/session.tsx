"use client";

import { createContext, useContext, useEffect, useState } from "react";

import { fetchPortalMe, logoutPortal, type PortalQuotaSummary, type PortalSessionPayload, type PortalUser } from "@/lib/api";

type PortalSessionContextValue = {
  initialized: boolean;
  isRefreshing: boolean;
  user: PortalUser | null;
  quota: PortalQuotaSummary | null;
  refreshSession: () => Promise<void>;
  applySession: (payload: PortalSessionPayload | null) => void;
  logout: () => Promise<void>;
};

const PortalSessionContext = createContext<PortalSessionContextValue | null>(null);

export function PortalSessionProvider({ children }: { children: React.ReactNode }) {
  const [initialized, setInitialized] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [user, setUser] = useState<PortalUser | null>(null);
  const [quota, setQuota] = useState<PortalQuotaSummary | null>(null);

  const applySession = (payload: PortalSessionPayload | null) => {
    setUser(payload?.user ?? null);
    setQuota(payload?.quota ?? null);
    setInitialized(true);
  };

  const refreshSession = async () => {
    setIsRefreshing(true);
    try {
      const payload = await fetchPortalMe();
      setUser(payload.user);
      setQuota(payload.quota);
    } catch {
      setUser(null);
      setQuota(null);
    } finally {
      setInitialized(true);
      setIsRefreshing(false);
    }
  };

  const logout = async () => {
    try {
      await logoutPortal();
    } finally {
      setUser(null);
      setQuota(null);
      setInitialized(true);
      if (typeof window !== "undefined") {
        window.location.href = "/portal/login";
      }
    }
  };

  useEffect(() => {
    void refreshSession();
  }, []);

  return (
    <PortalSessionContext.Provider
      value={{
        initialized,
        isRefreshing,
        user,
        quota,
        refreshSession,
        applySession,
        logout,
      }}
    >
      {children}
    </PortalSessionContext.Provider>
  );
}

export function usePortalSession() {
  const value = useContext(PortalSessionContext);
  if (!value) {
    throw new Error("PortalSessionProvider is missing");
  }
  return value;
}
