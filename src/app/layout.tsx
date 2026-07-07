import type { Metadata } from "next";
import "./globals.css";
import { SideBar } from "@/components/shared/side-bar";
import { ToastProvider } from "@/components/shared/toast";
import { RoleProvider } from "@/components/shared/role-context";
import { RoleSwitcher } from "@/components/shared/role-switcher";

export const metadata: Metadata = {
  title: "运单全流程管理 V3 - 扫描品控·异常审批·执行联动",
  description: "运单全生命周期管理：扫描品控、异常上报、分级审批、赔付库存联动",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-[#f7f8fa] antialiased">
        <ToastProvider>
          <RoleProvider>
            <SideBar />
            <main className="pt-14 lg:pt-0 lg:pl-[224px]">{children}</main>
            <RoleSwitcher />
          </RoleProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
