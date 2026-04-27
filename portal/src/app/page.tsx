"use client";

import { Navigate } from "react-router-dom";
import { usePortalSession } from "@/store/session";

export default function HomePage() {
  const { initialized, user } = usePortalSession();

  if (!initialized) {
    return (
      <div className="grid h-full min-h-0 place-items-center">
        <div className="rounded-3xl border border-stone-200 bg-white px-6 py-4 text-sm text-stone-500 shadow-sm">
          正在加载工作区...
        </div>
      </div>
    );
  }

  return <Navigate to={user ? "/workspace" : "/login"} replace />;
}
