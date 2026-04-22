import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";
import { TopNav } from "@/components/top-nav";

export const metadata: Metadata = {
  title: "ChatGpt Image Studio",
  description: "Image workspace and account control center",
  icons: {
    icon: "/favicon-studio.svg",
    shortcut: "/favicon-studio.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className="antialiased lg:overflow-hidden"
        style={{
          fontFamily:
            '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif',
        }}
      >
        <Toaster position="top-center" richColors />
        <main className="min-h-screen bg-[#f5f5f3] p-3 text-stone-900 lg:h-dvh lg:overflow-hidden lg:box-border lg:p-4">
          <div className="mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-[1680px] flex-col gap-3 lg:h-full lg:min-h-0 lg:flex-row lg:gap-4">
            <TopNav />
            <div className="min-w-0 flex-1 lg:h-full lg:min-h-0">{children}</div>
          </div>
        </main>
      </body>
    </html>
  );
}
