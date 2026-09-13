import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";

export const metadata: Metadata = {
  title: "VYNORA SaaS Command Center",
  description: "AI Sales Agency Operations",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased min-h-screen bg-black text-gray-100 overflow-hidden flex font-sans">
        <aside className="w-72 h-screen flex-shrink-0 z-40 bg-black border-r border-gray-800 hidden md:block">
          <Sidebar />
        </aside>
        <main className="flex-1 flex flex-col h-screen overflow-hidden bg-black relative">
          <Header />
          <div className="flex-1 overflow-y-auto p-4 md:p-8 w-full max-w-[100vw]">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
