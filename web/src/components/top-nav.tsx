"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ImageIcon, LogOut, PanelLeftClose, PanelLeftOpen, Shield, Sparkles } from "lucide-react";

import webConfig from "@/constants/common-env";
import { clearStoredAuthKey } from "@/store/auth";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/image", label: "图片工作台", description: "生成、编辑与放大", icon: ImageIcon },
  { href: "/accounts", label: "账号管理", description: "号池、额度与同步", icon: Shield },
];

type DesktopTopNavProps = {
  pathname: string;
  defaultCollapsed: boolean;
  onLogout: () => Promise<void>;
};

function DesktopTopNav({ pathname, defaultCollapsed, onLogout }: DesktopTopNavProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <aside className={cn("hidden shrink-0 transition-[width] duration-200 lg:flex", collapsed ? "w-[92px]" : "w-[228px]")}>
      <div className="flex h-full w-full flex-col rounded-[28px] border border-stone-200 bg-[#f0f0ed] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
        <div className={cn("gap-2", collapsed ? "flex flex-col items-center" : "flex items-center justify-between")}>
          <Link
            href="/image"
            className={cn(
              "flex items-center rounded-2xl transition hover:bg-white/70",
              collapsed ? "justify-center px-0 py-1" : "min-w-0 flex-1 gap-3 px-3 py-3",
            )}
          >
            <span className={cn("flex items-center justify-center rounded-2xl bg-white text-stone-900 shadow-sm", collapsed ? "size-11" : "size-10")}>
              <Sparkles className={cn(collapsed ? "size-5" : "size-4")} />
            </span>
            {!collapsed ? (
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold tracking-tight text-stone-900">
                  ChatGpt Image Studio
                </span>
                <span className="block truncate text-xs text-stone-500">简洁的图片工作区</span>
              </span>
            ) : null}
          </Link>

          <button
            type="button"
            className={cn(
              "inline-flex items-center justify-center rounded-2xl border border-stone-200 bg-white text-stone-600 transition hover:bg-stone-50 hover:text-stone-900",
              collapsed ? "size-11" : "size-10",
            )}
            onClick={() => setCollapsed((current) => !current)}
            aria-label={collapsed ? "展开导航" : "收起导航"}
          >
            {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-4" />}
          </button>
        </div>

        <nav className="mt-4 space-y-1">
          {navItems.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex rounded-2xl transition",
                  collapsed ? "justify-center px-0 py-3.5" : "items-center gap-3 px-3 py-3",
                  active ? "bg-white text-stone-950 shadow-sm" : "text-stone-600 hover:bg-white/65 hover:text-stone-900",
                )}
                title={collapsed ? item.label : undefined}
              >
                <span
                  className={cn(
                    "flex items-center justify-center rounded-2xl",
                    collapsed ? "size-11" : "size-9",
                    active ? "bg-stone-950 text-white" : "bg-white/80 text-stone-600",
                  )}
                >
                  <Icon className={cn(collapsed ? "size-5" : "size-4")} />
                </span>
                {!collapsed ? (
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{item.label}</span>
                    <span className="block truncate text-xs text-stone-500">{item.description}</span>
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto space-y-3">
          <div className={cn("rounded-2xl bg-white/70 text-xs text-stone-500 shadow-sm", collapsed ? "px-2 py-3 text-center" : "px-4 py-3")}>
            {!collapsed ? <div className="font-medium text-stone-700">版本</div> : null}
            <div className={cn(!collapsed ? "mt-1" : "font-medium")}>v{webConfig.appVersion}</div>
          </div>
          <button
            type="button"
            className={cn(
              "flex w-full items-center rounded-2xl border border-stone-200 bg-white text-sm font-medium text-stone-700 transition hover:bg-stone-50",
              collapsed ? "justify-center px-0 py-3" : "justify-center gap-2 px-4 py-3",
            )}
            onClick={() => void onLogout()}
            title={collapsed ? "退出登录" : undefined}
          >
            <LogOut className="size-4" />
            {!collapsed ? "退出登录" : null}
          </button>
        </div>
      </div>
    </aside>
  );
}

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const isImageRoute = pathname === "/image" || pathname?.startsWith("/image/");

  const handleLogout = async () => {
    await clearStoredAuthKey();
    router.replace("/login");
  };

  if (pathname === "/login" || pathname === "/login.html" || pathname.startsWith("/login/")) {
    return null;
  }

  return (
    <>
      <header className="lg:hidden">
        <div className="rounded-[26px] border border-stone-200 bg-[#f0f0ed] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/image"
              className="flex min-w-0 items-center gap-3 rounded-2xl px-1 py-1 transition hover:bg-white/70"
            >
              <span className="flex size-10 items-center justify-center rounded-2xl bg-white text-stone-900 shadow-sm">
                <Sparkles className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold tracking-tight text-stone-900">
                  ChatGpt Image Studio
                </span>
                <span className="block truncate text-xs text-stone-500">简洁的图片工作区</span>
              </span>
            </Link>
            <button
              type="button"
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-2xl border border-stone-200 bg-white px-3 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
              onClick={() => void handleLogout()}
            >
              <LogOut className="size-4" />
            </button>
          </div>

          <nav className="mt-3 grid grid-cols-2 gap-2">
            {navItems.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl px-3 py-3 transition",
                    active ? "bg-white text-stone-950 shadow-sm" : "bg-white/60 text-stone-600 hover:bg-white hover:text-stone-900",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-9 items-center justify-center rounded-xl",
                      active ? "bg-stone-950 text-white" : "bg-white text-stone-600",
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{item.label}</span>
                    <span className="block truncate text-xs text-stone-500">{item.description}</span>
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <DesktopTopNav
        key={isImageRoute ? "image-route" : "non-image-route"}
        pathname={pathname}
        defaultCollapsed={isImageRoute}
        onLogout={handleLogout}
      />
    </>
  );
}
