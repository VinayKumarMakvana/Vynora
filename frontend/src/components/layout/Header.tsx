"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Bell, Search, Power, CheckCircle2, AlertCircle, Info, XCircle, X, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { dashboardAPI } from "@/lib/api";
import { SidebarContent } from "@/components/layout/Sidebar";

interface Notification {
  id: string;
  title: string;
  message: string;
  severity: string;
  time: string;
  workflow: string;
  read: boolean;
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function SeverityIcon({ severity }: { severity: string }) {
  const s = severity?.toUpperCase();
  if (s === 'HIGH' || s === 'ERROR') return <XCircle className="h-4 w-4 text-red-400 shrink-0" />;
  if (s === 'WARNING' || s === 'MEDIUM') return <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />;
  if (s === 'SUCCESS') return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />;
  return <Info className="h-4 w-4 text-indigo-400 shrink-0" />;
}

function severityBg(severity: string): string {
  const s = severity?.toUpperCase();
  if (s === 'HIGH' || s === 'ERROR') return 'border-l-2 border-red-500/50';
  if (s === 'WARNING' || s === 'MEDIUM') return 'border-l-2 border-amber-500/50';
  if (s === 'SUCCESS') return 'border-l-2 border-emerald-500/50';
  return 'border-l-2 border-indigo-500/30';
}

// Countdown to next 8-hour shift cycle (00:00, 08:00, 16:00 UTC)
function useNextCycleCountdown() {
  const [countdown, setCountdown] = useState('--:--:--');
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const hours = now.getUTCHours();
      let nextHour = 24;
      if (hours < 8) nextHour = 8;
      else if (hours < 16) nextHour = 16;
      else nextHour = 24;
      
      const nextDate = new Date(now);
      nextDate.setUTCHours(nextHour, 0, 0, 0);
      
      const diffMs = nextDate.getTime() - now.getTime();
      const h = Math.floor(diffMs / (1000 * 60 * 60)).toString().padStart(2, '0');
      const m = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, '0');
      const s = Math.floor((diffMs % (1000 * 60)) / 1000).toString().padStart(2, '0');
      
      setCountdown(`${h}:${m}:${s}`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);
  return countdown;
}

export function Header() {
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const countdown = useNextCycleCountdown();

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const data = await dashboardAPI.getNotifications();
      setNotifications(data || []);
    } catch {
      // Backend might be offline — keep existing
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount + every 30s
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const unreadCount = notifications.filter(n => !readIds.has(n.id)).length;

  const markAllRead = () => {
    setReadIds(new Set(notifications.map(n => n.id)));
  };

  const markOneRead = (id: string) => {
    setReadIds(prev => new Set([...Array.from(prev), id]));
  };

  const handleBellClick = () => {
    setShowNotifications(prev => !prev);
    if (!showNotifications) fetchNotifications();
  };

  return (
    <header className="h-20 flex items-center justify-between px-4 md:px-8 bg-black border-b border-gray-800 sticky top-0 z-50 w-full">
      <div className="flex items-center flex-1 gap-4">
        {/* Mobile Menu Button */}
        <button 
          onClick={() => setShowMobileMenu(true)}
          className="md:hidden text-gray-400 hover:text-white transition-colors p-1"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
        </button>

        <div className="relative w-full max-w-md hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
          <input 
            type="text" 
            placeholder="Search leads, domains, or logs..." 
            className="w-full bg-gray-900 border border-gray-700 rounded-lg py-2 pl-10 pr-4 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
          />
        </div>
      </div>
      
      <div className="flex items-center gap-6">
        {/* Live Countdown */}
          <div className="flex items-center gap-2 mr-1 md:mr-4">
            <span className="text-gray-400 text-xs md:text-sm font-medium hidden sm:inline">Next Shift:</span>
            <div className="bg-indigo-950/50 text-indigo-400 px-2 md:px-3 py-1 rounded border border-indigo-900/50 font-mono text-xs md:text-sm tracking-wider">
              {countdown}
            </div>
          </div>
        
        {/* Notification Bell */}
        <div className="relative" ref={dropdownRef}>
          <button 
            onClick={handleBellClick}
            className="relative text-gray-400 hover:text-gray-200 transition-colors focus:outline-none"
            aria-label="Open notifications"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-indigo-500 text-white text-[10px] font-bold flex items-center justify-center animate-pulse">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          <AnimatePresence>
            {showNotifications && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 mt-3 w-96 bg-[#0a0a0a] border border-gray-800 rounded-xl shadow-2xl overflow-hidden z-50"
              >
                {/* Header */}
                <div className="p-4 border-b border-gray-800 bg-gray-900/50 flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-100 text-sm">Notifications</h3>
                    {unreadCount > 0 && (
                      <span className="bg-indigo-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                        {unreadCount}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={fetchNotifications}
                      className={`text-gray-500 hover:text-gray-300 transition-colors ${loading ? 'animate-spin' : ''}`}
                      title="Refresh"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                    {unreadCount > 0 && (
                      <button
                        onClick={markAllRead}
                        className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                      >
                        Mark all read
                      </button>
                    )}
                    <button
                      onClick={() => setShowNotifications(false)}
                      className="text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Notification List */}
                <div className="max-h-[400px] overflow-y-auto">
                  {loading && notifications.length === 0 ? (
                    <div className="p-8 text-center text-gray-500 text-sm">
                      <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-indigo-400" />
                      Loading notifications...
                    </div>
                  ) : notifications.length === 0 ? (
                    <div className="p-8 text-center">
                      <Bell className="h-8 w-8 text-gray-700 mx-auto mb-3" />
                      <p className="text-gray-400 text-sm font-medium">All caught up!</p>
                      <p className="text-gray-600 text-xs mt-1">No system events yet.</p>
                    </div>
                  ) : (
                    notifications.map((notif) => {
                      const isRead = readIds.has(notif.id);
                      return (
                        <div
                          key={notif.id}
                          onClick={() => markOneRead(notif.id)}
                          className={`p-4 border-b border-gray-800/60 hover:bg-gray-800/40 transition-colors cursor-pointer flex gap-3 ${severityBg(notif.severity)} ${isRead ? 'opacity-50' : ''}`}
                        >
                          <div className="mt-0.5">
                            <SeverityIcon severity={notif.severity} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <p className={`text-sm font-medium truncate ${isRead ? 'text-gray-400' : 'text-gray-100'}`}>
                                {notif.title}
                              </p>
                              {!isRead && (
                                <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0 mt-1.5" />
                              )}
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{notif.message}</p>
                            <div className="flex items-center gap-2 mt-1.5">
                              {notif.workflow && (
                                <span className="text-[10px] text-indigo-400 bg-indigo-950/50 px-1.5 py-0.5 rounded font-mono">
                                  {notif.workflow.split('-')[1] || notif.workflow}
                                </span>
                              )}
                              <span className="text-[10px] text-gray-500">{notif.time ? timeAgo(notif.time) : '—'}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Footer */}
                <div className="p-3 text-center border-t border-gray-800 bg-gray-900/50">
                  <button
                    onClick={() => { markAllRead(); setShowNotifications(false); }}
                    className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    Clear all & close
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {showMobileMenu && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMobileMenu(false)}
              className="fixed inset-0 bg-black/80 z-[100] md:hidden"
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", bounce: 0, duration: 0.4 }}
              className="fixed top-0 left-0 bottom-0 w-72 bg-black border-r border-gray-800 z-[101] md:hidden shadow-2xl"
            >
              <div className="absolute top-6 right-4 z-50">
                <button 
                  onClick={() => setShowMobileMenu(false)}
                  className="p-1 text-gray-400 hover:text-white bg-gray-900 rounded-md"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <SidebarContent onNavigate={() => setShowMobileMenu(false)} />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </header>
  );
}
