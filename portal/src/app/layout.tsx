import { Toaster } from "sonner";
import "./globals.css";
import { TopNav } from "@/components/top-nav";

export default function AppShell({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <Toaster position="top-center" richColors />
      <main
        className="box-border h-full min-h-0 overflow-hidden bg-[#f5f5f3] p-3 text-stone-900 lg:p-4"
        style={{
          fontFamily:
            '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif',
        }}
      >
        <div className="mx-auto flex h-full min-h-0 max-w-[1680px] flex-col gap-3 lg:flex-row lg:gap-4">
          <TopNav />
          <div className="min-w-0 min-h-0 flex-1">{children}</div>
        </div>
      </main>
    </>
  );
}
