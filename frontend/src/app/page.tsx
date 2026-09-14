"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Mail, MessageSquare, DollarSign, Target, Activity, RefreshCw, Clock } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { dashboardAPI } from "@/lib/api";

function timeAgo(dateStr: string) {
  const d = new Date(dateStr);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

function logColor(log: any) {
  const s = (log.severity || '').toUpperCase();
  const msg = (log.message || log.result || '').toLowerCase();
  if (s === 'HIGH' || s === 'ERROR') return 'text-red-400';
  if (s === 'WARNING' || s === 'MEDIUM') return 'text-amber-400';
  if (s === 'SUCCESS' || msg.includes('sent') || msg.includes('complete')) return 'text-emerald-400';
  if (s === 'INFO' || msg.includes('found') || msg.includes('sourcing')) return 'text-blue-400';
  return 'text-gray-400';
}

export default function Home() {
  const [activeStat, setActiveStat] = useState<number | null>(null);
  const [statsData, setStatsData] = useState<any>(null);
  const [feedLogs, setFeedLogs] = useState<any[]>([]);
  const [shiftStats, setShiftStats] = useState<any>(null);
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [stats, feed, shift] = await Promise.all([
        dashboardAPI.getStats(),
        dashboardAPI.getFeed(),
        dashboardAPI.getShiftStats(),
      ]);
      setStatsData(stats || {});
      setFeedLogs(Array.isArray(feed) ? feed : []);
      setShiftStats(shift || {});
      setCountdown(shift?.msToNextShift || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // Live countdown
  useEffect(() => {
    const t = setInterval(() => setCountdown(c => Math.max(0, c - 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  function formatMs(ms: number) {
    if (ms <= 0) return '00:00:00';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  const statCards = statsData ? [
    {
      title: "Leads Sourced",
      value: (statsData.leadsSourced || 0).toLocaleString(),
      sub: `${(statsData.verifiedLeads || 0).toLocaleString()} verified · ${statsData.verifyRate || 0}% rate`,
      icon: Users,
      color: "text-emerald-400",
      bg: "bg-emerald-950/50",
      details: [
        `Total Leads: ${statsData.leadsSourced || 0}`,
        `Verified: ${statsData.verifiedLeads || 0}`,
        `Verification Rate: ${statsData.verifyRate || 0}%`
      ]
    },
    {
      title: "Outbound Sent",
      value: (statsData.outboundSent || 0).toLocaleString(),
      sub: `${statsData.sentToday || 0} sent today · cap: ${statsData.dailyCap || 25}`,
      icon: Mail,
      color: "text-indigo-400",
      bg: "bg-indigo-950/50",
      details: [
        `Total Sent: ${statsData.outboundSent || 0}`,
        `Sent Today: ${statsData.sentToday || 0}`,
        `Daily Cap: ${statsData.dailyCap || 25}`
      ]
    },
    {
      title: "Replies Inbox",
      value: (statsData.replies || 0).toLocaleString(),
      sub: "Inbound replies received",
      icon: MessageSquare,
      color: "text-purple-400",
      bg: "bg-purple-950/50",
      details: [
        `Total Replies: ${statsData.replies || 0}`,
        `AI currently handling active threads`,
        `Manual review triggered on positive intent`
      ]
    },
    {
      title: "Verified Revenue",
      value: `$${(statsData.revenue || 0).toLocaleString()}`,
      sub: `$${(statsData.pendingRevenue || 0).toLocaleString()} pending`,
      icon: DollarSign,
      color: "text-blue-400",
      bg: "bg-blue-950/50",
      details: [
        `Verified: $${(statsData.revenue || 0).toLocaleString()}`,
        `Pending: $${(statsData.pendingRevenue || 0).toLocaleString()}`,
        `Total: $${((statsData.revenue || 0) + (statsData.pendingRevenue || 0)).toLocaleString()}`
      ]
    }
  ] : [];

  const sendPercent = statsData ? Math.min(100, Math.round((statsData.sentToday / (statsData.dailyCap || 1)) * 100)) : 0;
  const qualityRate = statsData ? statsData.verifyRate : 0;
  const shiftSent = shiftStats?.sentThisShift || 0;
  const shiftLimit = shiftStats?.shiftLimit || 25;
  const shiftPercent = Math.min(100, Math.round((shiftSent / shiftLimit) * 100));
  const shiftNames = ['Shift 1 (00:00–08:00 IST)', 'Shift 2 (08:00–16:00 IST)', 'Shift 3 (16:00–00:00 IST)'];
  const currentShift = shiftNames[shiftStats?.currentShiftIdx ?? 0] || 'Shift 1';

  // Latest opportunities from logs (role: follow-up)
  const followupLogs = feedLogs.filter((l: any) => 
    (l.workflow || '').toLowerCase().includes('follow') || 
    (l.action || '').toLowerCase().includes('follow')
  ).slice(0, 3);

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-gray-100 flex items-center gap-3">
            Mission Control
          </h1>
          <p className="text-gray-400 text-sm">Live overview of Vynora AI Sales Agency operations.</p>
        </div>
        <button onClick={fetchAll} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-300 transition-colors">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[120px] rounded-xl bg-gray-900 border border-gray-800 animate-pulse" />
          ))
        ) : (
          statCards.map((stat, i) => (
            <motion.div
              key={stat.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
            >
              <Card
                className={`hover:border-indigo-500/50 transition-all cursor-pointer ${activeStat === i ? 'ring-1 ring-indigo-500 border-transparent' : ''}`}
                onClick={() => setActiveStat(activeStat === i ? null : i)}
              >
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-gray-400">{stat.title}</CardTitle>
                  <div className={`p-2 rounded-lg ${stat.bg}`}>
                    <stat.icon className={`h-4 w-4 ${stat.color}`} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-gray-100">{stat.value}</div>
                  <p className="text-xs text-gray-500 mt-1">{stat.sub}</p>
                  <AnimatePresence>
                    {activeStat === i && (
                      <motion.div
                        initial={{ height: 0, opacity: 0, marginTop: 0 }}
                        animate={{ height: "auto", opacity: 1, marginTop: 12 }}
                        exit={{ height: 0, opacity: 0, marginTop: 0 }}
                        className="overflow-hidden border-t border-gray-800 pt-3"
                      >
                        <ul className="text-xs text-gray-400 space-y-1.5">
                          {stat.details.map((d, idx) => (
                            <li key={idx} className="flex items-center gap-2">
                              <div className={`h-1 w-1 rounded-full ${stat.color.replace('text', 'bg')}`} />
                              {d}
                            </li>
                          ))}
                        </ul>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </CardContent>
              </Card>
            </motion.div>
          ))
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
        {/* Live Log Feed */}
        <Card className="col-span-4 flex flex-col shadow-sm">
          <CardHeader className="border-b border-gray-800 bg-gray-900/50">
            <CardTitle className="text-gray-100 flex items-center gap-2">
              <Activity className="h-5 w-5 text-indigo-400" />
              Live Output Feed (W17)
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-0">
            <div className="bg-black font-mono text-xs text-gray-400 h-[350px] overflow-y-auto space-y-1.5 p-6 rounded-b-xl border-t border-gray-800">
              {feedLogs.length > 0 ? feedLogs.map((log: any, idx) => (
                <div key={idx} className={logColor(log)}>
                  [{log.log_time ? new Date(log.log_time).toISOString() : new Date(log.createdAt).toISOString()}]
                  {log.workflow ? ` [${log.workflow}]` : ''}
                  {log.action ? ` [${log.action}]` : ''}
                  {' '}{log.message || log.result || ''}
                </div>
              )) : (
                <div className="text-gray-600 italic text-center mt-8">
                  {loading ? 'Loading logs...' : 'No logs yet — engine has not run.'}
                </div>
              )}
              <div className="flex gap-2 mt-4">
                <span className="w-2 h-4 bg-indigo-500 animate-pulse" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Active Goals */}
        <Card className="col-span-3 shadow-sm">
          <CardHeader className="border-b border-gray-800">
            <CardTitle className="text-gray-100 flex items-center gap-2">
              <Target className="h-5 w-5 text-amber-500" />
              Active Goals
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            {/* Daily */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400 font-medium">Daily Send ({statsData?.sentToday || 0}/{statsData?.dailyCap || 75})</span>
                <span className="text-gray-100 font-bold">{sendPercent}%</span>
              </div>
              <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${sendPercent}%` }} transition={{ duration: 1, ease: "easeOut" }}
                  className={`h-full ${sendPercent > 80 ? 'bg-red-500' : sendPercent > 50 ? 'bg-amber-500' : 'bg-indigo-500'}`}
                />
              </div>
            </div>

            {/* This Shift with live countdown */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400 font-medium">This Shift ({shiftSent}/{shiftLimit})</span>
                <span className="text-gray-100 font-bold">{shiftPercent}%</span>
              </div>
              <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${shiftPercent}%` }} transition={{ duration: 1, ease: "easeOut" }}
                  className={`h-full ${shiftPercent > 80 ? 'bg-red-500' : shiftPercent > 50 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-600">{currentShift}</p>
                <p className="text-xs text-amber-400 flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Next: <span className="font-mono">{formatMs(countdown)}</span>
                </p>
              </div>
            </div>

            {/* Quality */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400 font-medium">Lead Quality Rate</span>
                <span className="text-gray-100 font-bold">{qualityRate}%</span>
              </div>
              <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${qualityRate}%` }} transition={{ duration: 1, ease: "easeOut" }}
                  className="h-full bg-emerald-500"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-gray-800">
              <h4 className="text-sm font-semibold text-gray-100 mb-3">Recent Follow-up Activity</h4>
              {followupLogs.length > 0 ? (
                <div className="space-y-2">
                  {followupLogs.map((log: any, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-gray-800 bg-gray-900">
                      <div className="h-2 w-2 rounded-full bg-indigo-500 mt-1.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-100 truncate">{log.action || log.workflow}</p>
                        <p className="text-xs text-gray-500 truncate">{log.message || log.result}</p>
                        <p className="text-[10px] text-gray-600 mt-0.5">{log.log_time ? timeAgo(log.log_time) : timeAgo(log.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-600 italic">No follow-up activity yet.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
