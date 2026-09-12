"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { 
  LayoutDashboard, 
  Users, 
  Send, 
  Settings,
  Activity,
  CreditCard
} from "lucide-react";
import { useState, useEffect } from "react";
import { dashboardAPI } from "@/lib/api";

const routes = [
  { label: "Mission Control", icon: LayoutDashboard, href: "/", color: "text-sky-500" },
  { label: "Sourcing Engine", icon: Users, href: "/leads", color: "text-emerald-500" },
  { label: "Outbound & Queue", icon: Send, href: "/outreach", color: "text-purple-500" },
  { label: "Pipeline & Closing", icon: Activity, href: "/pipeline", color: "text-amber-500" },
  { label: "Finance & Analytics", icon: CreditCard, href: "/finance", color: "text-green-500" },
  { label: "Engine Config", icon: Settings, href: "/settings", color: "text-neutral-400" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [engineStatus, setEngineStatus] = useState<'checking' | 'active' | 'offline'>('checking');

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await dashboardAPI.getHealth();
        if (res && res.status === 'ok') {
          setEngineStatus('active');
        } else {
          setEngineStatus('offline');
        }
      } catch (err) {
        setEngineStatus('offline');
      }
    };
    
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-4 py-4 flex flex-col h-full bg-black shadow-[2px_0_15px_rgba(0,0,0,0.5)]">
      <div className="px-3 py-2 flex-1">
        <Link href="/" className="block px-4 mb-12 mt-2">
          <img 
            src="/logo.png" 
            alt="VYNORA Technology Innovation Impact" 
            className="w-full h-auto object-contain max-w-[200px]"
          />
        </Link>
        <div className="space-y-1">
          {routes.map((route) => (
            <Link
              key={route.href}
              href={route.href}
              className={cn(
                "text-sm group flex p-3 w-full justify-start font-medium cursor-pointer rounded-lg transition-all",
                pathname === route.href ? "text-indigo-400 bg-indigo-950/50" : "text-gray-400 hover:text-gray-100 hover:bg-gray-800"
              )}
            >
              <div className="flex items-center flex-1">
                <route.icon className={cn("h-5 w-5 mr-3", pathname === route.href ? "text-indigo-400" : "text-gray-500 group-hover:text-gray-300")} />
                {route.label}
              </div>
            </Link>
          ))}
        </div>
      </div>
      <div className="px-6 py-4">
        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">System Status</span>
            
            {engineStatus === 'checking' && (
              <span className="text-sm font-semibold text-gray-400 flex items-center gap-2 mt-1">
                Checking...
              </span>
            )}
            
            {engineStatus === 'active' && (
              <span className="text-sm font-semibold text-emerald-400 flex items-center gap-2 mt-1">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                Engine Active
              </span>
            )}

            {engineStatus === 'offline' && (
              <span className="text-sm font-semibold text-red-500 flex items-center gap-2 mt-1">
                <span className="relative flex h-2 w-2">
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600"></span>
                </span>
                Engine Offline
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
