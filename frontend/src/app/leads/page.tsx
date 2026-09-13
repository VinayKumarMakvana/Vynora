"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Search, Filter, Play, CheckCircle2, XCircle, AlertCircle, ShieldCheck, X, FileText, Globe } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { dashboardAPI } from "@/lib/api";


export default function LeadsPage() {
  const [selectedLead, setSelectedLead] = useState<any | null>(null);
  const [leads, setLeads] = useState<any[]>([]);
  const [isSourcing, setIsSourcing] = useState(false);

  useEffect(() => {
    fetchLeads();
  }, []);

  const fetchLeads = () => {
    dashboardAPI.getLeads().then(data => {
      setLeads(Array.isArray(data) ? data : []);
    }).catch(console.error);
  };

  const handleForceSourcing = async () => {
    setIsSourcing(true);
    try {
      await dashboardAPI.forceRunSourcing();
      setTimeout(fetchLeads, 2000); // refresh leads after 2s
    } catch (e) {
      console.error(e);
    }
    setIsSourcing(false);
  };

  return (
    <div className="space-y-6 pb-10 h-full flex flex-col relative">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-gray-100 flex items-center gap-2">
            Sourcing Engine
            <ShieldCheck className="h-5 w-5 text-indigo-400" />
          </h1>
          <p className="text-gray-400 text-sm">Manage, filter, and review the W10 AI sourcing pipeline.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" className="gap-2">
            <Filter className="h-4 w-4" />
            Filters
          </Button>
          <Button variant="success" className="gap-2" onClick={handleForceSourcing} disabled={isSourcing}>
            <Play className={`h-4 w-4 fill-current ${isSourcing ? 'animate-pulse' : ''}`} />
            {isSourcing ? 'Sourcing...' : 'Force Run Sourcing'}
          </Button>
        </div>
      </div>

      <Card className="flex-1 flex flex-col min-h-[500px]">
        <CardHeader className="pb-4 border-b border-gray-800 bg-[#111827]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-lg text-gray-100">Lead Database</CardTitle>
              <CardDescription>200 Target / Shift (Currently showing last batch)</CardDescription>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <input 
                type="text" 
                placeholder="Search company or email..." 
                className="w-full bg-gray-900 border border-gray-700 rounded-md py-2 pl-9 pr-4 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 flex-1 overflow-hidden flex flex-col">
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-400 bg-gray-900 sticky top-0 uppercase font-semibold border-b border-gray-800">
                <tr>
                  <th className="px-6 py-4">Company</th>
                  <th className="px-6 py-4">Email</th>
                  <th className="px-6 py-4">MX Verified</th>
                  <th className="px-6 py-4">Fit Score</th>
                  <th className="px-6 py-4">Priority</th>
                  <th className="px-6 py-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800 text-gray-300 bg-[#111827]">
                {leads.length > 0 ? leads.map((lead, i) => (
                  <motion.tr 
                    key={lead.id || lead._id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    onClick={() => setSelectedLead(lead)}
                    className="hover:bg-indigo-950/50 transition-colors cursor-pointer group"
                  >
                    <td className="px-6 py-4 font-medium text-gray-100 group-hover:text-indigo-400">{lead.company || lead.company_id}</td>
                    <td className="px-6 py-4">
                      {lead.email && lead.email !== "None" ? (
                        lead.email
                      ) : (
                        <span className="text-gray-500 italic">No public email</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {lead.mx !== false ? (
                        <span className="flex items-center gap-1 text-emerald-400 font-medium">
                          <CheckCircle2 className="h-4 w-4" /> Pass
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-400 font-medium">
                          <XCircle className="h-4 w-4" /> Fail
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-20 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                          <div 
                            className={`h-full ${(lead.score || 85) >= 80 ? 'bg-emerald-500' : (lead.score || 85) >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                            style={{ width: `${lead.score || 85}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs font-semibold text-gray-100">{lead.score || 85}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border
                        ${(lead.priority || 'High') === 'High' ? 'bg-indigo-950 text-indigo-400 border-indigo-800' : 
                          (lead.priority || 'Medium') === 'Medium' ? 'bg-gray-800 text-gray-300 border-gray-700' : 
                          'bg-red-950 text-red-400 border-red-800'}`}
                      >
                        {lead.priority || 'High'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {lead.status === 'queued' || lead.status === 'new' ? (
                        <span className="text-amber-500 flex items-center justify-end gap-1 font-medium">
                          <AlertCircle className="h-4 w-4" /> Queued
                        </span>
                      ) : (
                        <span className="text-gray-500 flex items-center justify-end gap-1 font-medium">
                          <XCircle className="h-4 w-4" /> Rejected
                        </span>
                      )}
                    </td>
                  </motion.tr>
                )) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center text-gray-500">
                      <p className="font-medium">No leads in database yet.</p>
                      <p className="text-sm mt-1">Run the sourcing engine to populate leads.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="p-4 border-t border-gray-800 flex items-center justify-between text-sm text-gray-400 bg-gray-900">
            <span>Showing {leads.length} leads from Lead database.</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled>Previous</Button>
              <Button variant="outline" size="sm">Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Slide-over Drawer */}
      <AnimatePresence>
        {selectedLead && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedLead(null)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", bounce: 0, duration: 0.4 }}
              className="fixed right-0 top-0 h-screen w-[400px] bg-[#111827] shadow-2xl border-l border-gray-800 z-50 flex flex-col"
            >
              <div className="p-6 border-b border-gray-800 flex items-start justify-between bg-gray-900">
                <div>
                  <h2 className="text-xl font-bold text-gray-100">{selectedLead.company || selectedLead.company_id || 'Unknown Company'}</h2>
                  <p className="text-sm text-gray-400 flex items-center gap-1 mt-1">
                    <Globe className="h-3 w-3" /> {selectedLead.domain || (selectedLead.company ? `${selectedLead.company.toLowerCase().replace(/ /g, '')}.com` : 'N/A')}
                  </p>
                </div>
                <button onClick={() => setSelectedLead(null)} className="p-2 bg-gray-800 rounded-full border border-gray-700 hover:bg-gray-700 text-gray-400 hover:text-gray-100 transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-gray-100 mb-2 uppercase tracking-wider">AI Enrichment Notes</h3>
                  <div className="bg-amber-950/30 border border-amber-900/50 p-4 rounded-lg text-sm text-amber-200 flex items-start gap-3">
                    <FileText className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                    <p>{selectedLead.notes || 'No AI enrichment notes available.'}</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                    <p className="text-xs text-gray-400 font-medium">Fit Score</p>
                    <p className="text-2xl font-bold text-gray-100 mt-1">{selectedLead.score ?? '—'}/100</p>
                  </div>
                  <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                    <p className="text-xs text-gray-400 font-medium">MX Verification</p>
                    <p className={`text-lg font-bold mt-1 ${selectedLead.mx ? 'text-emerald-400' : 'text-red-400'}`}>
                      {selectedLead.mx ? 'Passed' : 'Failed'}
                    </p>
                  </div>
                </div>
                
                <div className="pt-4 border-t border-gray-800">
                  <h3 className="text-sm font-semibold text-gray-100 mb-2">Primary Contact</h3>
                  <p className="text-sm text-gray-300">{selectedLead.email || <span className="text-gray-500 italic">No public email found</span>}</p>
                </div>
              </div>
              <div className="p-4 border-t border-gray-800 bg-gray-900 flex gap-3">
                <Button variant="outline" className="flex-1">Edit Record</Button>
                <Button className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white">Push to Queue</Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
