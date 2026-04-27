"use client";

import { Navigate } from "react-router-dom";

import { usePortalSession } from "@/store/session";

function LoadingState() {
  return (
    <div className="grid h-full min-h-0 place-items-center">
      <div className="rounded-3xl border border-stone-200 bg-white px-6 py-4 text-sm text-stone-500 shadow-sm">
        正在验证登录状态...
      </div>
    </div>
  );
}

export function RequirePortalAuth({ children }: { children: React.ReactNode }) {
  const { initialized, user } = usePortalSession();
  if (!initialized) {
    return <LoadingState />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export function RequirePortalAdmin({ children }: { children: React.ReactNode }) {
  const { initialized, user } = usePortalSession();
  if (!initialized) {
    return <LoadingState />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (user.role !== "admin") {
    return <Navigate to="/workspace" replace />;
  }
  return <>{children}</>;
}
