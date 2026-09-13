"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Send, Clock, PlayCircle, MessageSquare, AlertTriangle, UserCheck, RefreshCw, Inbox } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { dashboardAPI } from "@/lib/api";

function timeAgo(dateStr: string) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

export default function OutreachPage() {
  const [activeTab, setActiveTab] = useState<'queue' | 'inbox'>('queue');
  const [queue, setQueue] = useState<any[]>([]);
  const [inbox, setInbox] = useState<any[]>([]);
  const [selectedMsg, setSelectedMsg] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [q, i, s] = await Promise.all([
          dashboardAPI.getOutreachQueue(),
          dashboardAPI.getInboxMessages(),
          dashboardAPI.getStats()
        ]);
        setQueue(q || []);
        setInbox(i || []);
        setStats(s);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    fetchData();
  }, []);

  const sentToday = stats?.sentToday || 0;
  const dailyCap = stats?.dailyCap || 25;
  const capPercent = Math.min(100, Math.round((sentToday / dailyCap) * 100));

  return (
    <div className="space-y-6 pb-10 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-gray-100 flex items-center gap-3">
            Outbound & Mailbox
            <Send className="h-5 w-5 text-indigo-400" />
          </h1>
          <p className="text-gray-400 text-sm">Manage the W01 Outbound Priority Queue and W11 Inbox Replies.</p>
        </div>
        <div className="flex items-center bg-black/40 p-1 rounded-lg border border-gray-800">
          <button
            onClick={() => setActiveTab('queue')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'queue' ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
          >
            Priority Queue ({queue.length})
          </button>
          <button
            onClick={() => setActiveTab('inbox')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'inbox' ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
          >
            Inbox ({inbox.length})
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin text-indigo-400" />
        </div>
      ) : (
        <>
          {/* Queue Tab */}
          {activeTab === 'queue' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid gap-6 md:grid-cols-3 flex-1">
              <Card className="md:col-span-2 flex flex-col">
                <CardHeader className="border-b border-gray-800 bg-gray-900/50">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <CardTitle className="text-gray-100">Next Dispatch Batch</CardTitle>
                      <CardDescription>High-fit leads queued for the next 30-min control cycle.</CardDescription>
                    </div>
                    <Button variant="outline" className="gap-2 w-full sm:w-auto justify-center" onClick={() => dashboardAPI.forceRunSourcing()}>
                      <PlayCircle className="h-4 w-4" /> Dispatch Now
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0 flex-1 overflow-y-auto max-h-[500px]">
                  {queue.length === 0 ? (
                    <div className="p-12 text-center text-gray-500">
                      <Send className="h-10 w-10 mx-auto mb-3 opacity-20" />
                      <p className="font-medium">Queue is empty</p>
                      <p className="text-sm mt-1">No qualified leads waiting for outreach.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-800">
                      {queue.map((lead: any, i) => (
                        <motion.div
                          key={lead._id || lead.lead_id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.04 }}
                          className="p-4 hover:bg-gray-800/40 transition-colors group cursor-pointer"
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <h4 className="text-gray-100 font-medium group-hover:text-indigo-400 transition-colors">
                                {lead.company_id || lead.company || 'Unknown Company'}
                              </h4>
                              <p className="text-sm text-gray-400">
                                {lead.email || 'No email'} · Lead ID: {lead.lead_id || lead._id?.toString().slice(-6)}
                              </p>
                            </div>
                            <span className="bg-emerald-950/50 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded text-xs font-semibold">
                              Score: {lead.fit_score || lead.score || '—'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-xs mt-2">
                            <span className="flex items-center gap-1 text-indigo-400 bg-indigo-950/50 px-2 py-1 rounded">
                              <UserCheck className="h-3 w-3" />
                              {lead.qualification_status || 'qualified'}
                            </span>
                            <span className="flex items-center gap-1 text-gray-500">
                              <Clock className="h-3 w-3" />
                              Queued {timeAgo(lead.createdAt)}
                            </span>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="border-b border-gray-800 bg-gray-900/50">
                  <CardTitle className="text-gray-100">Queue Safety & Limits</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6 pt-6">
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-gray-400">Daily Volume ({sentToday} / {dailyCap})</span>
                      <span className="text-gray-100 font-mono">{capPercent}%</span>
                    </div>
                    <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${capPercent}%` }}
                        transition={{ duration: 1 }}
                        className={`h-full ${capPercent > 80 ? 'bg-red-500' : capPercent > 50 ? 'bg-amber-500' : 'bg-indigo-500'}`}
                      />
                    </div>
                    <p className="text-xs text-gray-600 mt-2">W01 pauses when cap is reached to protect domain reputation.</p>
                  </div>

                  <div className={`p-4 rounded-lg border ${queue.length === 0 ? 'bg-emerald-950/20 border-emerald-900/50' : 'bg-amber-950/20 border-amber-900/50'}`}>
                    <div className={`flex items-center gap-2 mb-2 ${queue.length === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                      <AlertTriangle className="h-4 w-4" />
                      <span className="text-sm font-semibold">Queue Health</span>
                    </div>
                    <p className="text-xs text-gray-300">
                      {queue.length === 0
                        ? 'Queue is empty. Engine will source new leads on next cycle.'
                        : `${queue.length} leads pending dispatch. Engine running normally.`}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Inbox Tab */}
          {activeTab === 'inbox' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex-1 bg-[#0a0a0a] border border-gray-800 rounded-xl flex flex-col md:flex-row overflow-hidden min-h-[500px]">
              <div className="w-full md:w-1/3 border-b md:border-b-0 md:border-r border-gray-800 flex flex-col max-h-[300px] md:max-h-none">
                <div className="p-4 border-b border-gray-800 bg-gray-900/50">
                  <h3 className="font-semibold text-gray-100 flex items-center gap-2">
                    <Inbox className="h-4 w-4 text-indigo-400" /> Recent Replies
                  </h3>
                </div>
                <div className="flex-1 overflow-y-auto divide-y divide-gray-800">
                  {inbox.length === 0 ? (
                    <div className="p-8 text-center text-gray-600">
                      <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-20" />
                      <p className="text-sm">No inbound replies yet.</p>
                    </div>
                  ) : (
                    inbox.map((msg: any) => (
                      <div
                        key={msg._id}
                        onClick={() => setSelectedMsg(msg)}
                        className={`p-4 hover:bg-gray-800/40 cursor-pointer transition-colors ${selectedMsg?._id === msg._id ? 'bg-indigo-950/30 border-l-2 border-indigo-500' : ''}`}
                      >
                        <div className="flex justify-between items-start mb-1">
                          <span className="text-sm font-medium text-gray-100 truncate pr-2">
                            {msg.contact_id || 'Unknown'}
                          </span>
                          <span className="text-xs text-gray-500 whitespace-nowrap">{timeAgo(msg.createdAt)}</span>
                        </div>
                        <p className="text-xs font-medium text-gray-300 truncate mb-1">{msg.subject || '(No subject)'}</p>
                        <p className="text-xs text-gray-500 line-clamp-2">{msg.body}</p>
                        <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded mt-1 inline-block ${
                          msg.purpose === 'inbound_reply' ? 'bg-emerald-950/50 text-emerald-400' : 'bg-gray-800 text-gray-400'
                        }`}>
                          {msg.purpose || 'reply'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="flex-1 flex flex-col">
                {selectedMsg ? (
                  <div className="flex flex-col h-full">
                    <div className="p-5 border-b border-gray-800 bg-gray-900/50">
                      <h3 className="font-semibold text-gray-100">{selectedMsg.subject || '(No Subject)'}</h3>
                      <p className="text-xs text-gray-500 mt-1">
                        From: {selectedMsg.contact_id} · {timeAgo(selectedMsg.createdAt)}
                      </p>
                    </div>
                    <div className="flex-1 p-6 overflow-y-auto">
                      <p className="text-sm text-gray-300 whitespace-pre-wrap">{selectedMsg.body}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-gray-600 p-8 text-center">
                    <MessageSquare className="h-12 w-12 mb-4 opacity-20" />
                    <h3 className="text-lg font-medium text-gray-400 mb-2">Select a conversation</h3>
                    <p className="text-sm max-w-md">The W11 Inbox shows inbound replies. Click a message to read it.</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
