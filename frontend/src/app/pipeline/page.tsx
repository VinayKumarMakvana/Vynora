"use client";
import { useState, useEffect } from "react";
import { Activity, Plus, MoreHorizontal, Calendar, DollarSign, Mail } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { dashboardAPI } from "@/lib/api";

const emptyKanban = {
  "Engaged": [],
  "Meeting Scheduled": [],
  "Negotiating (W12)": [],
  "Closed Won (W13)": []
};

export default function PipelinePage() {
  const [selectedDeal, setSelectedDeal] = useState<any | null>(null);
  const [pipelineData, setPipelineData] = useState<any>(emptyKanban);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dashboardAPI.getPipeline().then(opportunities => {
      const newKanban: any = {
        "Engaged": [],
        "Meeting Scheduled": [],
        "Negotiating (W12)": [],
        "Closed Won (W13)": []
      };

      const oppsArray = Array.isArray(opportunities) ? opportunities : [];
      oppsArray.forEach((opp: any) => {
        const item = {
          id: opp.opportunity_id || opp._id,
          company: opp.company_id || "Unknown",
          value: `$${(opp.value || 0).toLocaleString()}`,
          days: opp.days_in_stage || 1,
          lastContact: opp.last_contact_at ? new Date(opp.last_contact_at).toLocaleDateString() : 'No contact',
          intent: opp.priority || "Warm",
          aiActive: opp.ai_negotiation_active || false
        };

        if (['engaged', 'new', 'interested'].includes(opp.stage)) newKanban["Engaged"].push(item);
        else if (opp.stage === 'meeting_scheduled') newKanban["Meeting Scheduled"].push(item);
        else if (opp.stage === 'negotiating') newKanban["Negotiating (W12)"].push(item);
        else if (opp.stage === 'closed_won') newKanban["Closed Won (W13)"].push(item);
        else newKanban["Engaged"].push(item);
      });

      setPipelineData(newKanban);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 pb-10 h-full flex flex-col relative">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-gray-100 flex items-center gap-2">
          Pipeline & Closing
          <Activity className="h-5 w-5 text-indigo-400" />
        </h1>
        <p className="text-gray-400 text-sm">Track opportunities and monitor the W12 Negotiation & W13 Closing engines.</p>
      </div>

      <div className="flex-1 flex gap-6 overflow-x-auto pb-4 items-start">
        {Object.entries(pipelineData).map(([columnName, items]: [string, any], index) => (
          <div key={columnName} className="flex-shrink-0 w-80 flex flex-col bg-gray-900/50 rounded-xl border border-gray-800 h-full max-h-[75vh]">
            <div className="p-4 border-b border-gray-800 flex items-center justify-between bg-[#111827] rounded-t-xl">
              <h3 className="font-semibold text-gray-100 flex items-center gap-2 text-sm">
                {columnName}
                <span className="bg-gray-800 text-gray-300 text-xs px-2 py-0.5 rounded-full">{items.length}</span>
              </h3>
              <button className="text-gray-500 hover:text-gray-300 transition-colors">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            
            <div className="flex-1 p-3 overflow-y-auto space-y-3">
              {items.map((item: any, itemIndex: number) => (
                <motion.div 
                  key={item.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 + itemIndex * 0.05 }}
                  onClick={() => setSelectedDeal(item)}
                  className="bg-[#111827] border border-gray-700 p-4 rounded-lg cursor-grab active:cursor-grabbing hover:border-indigo-500/50 hover:shadow-md transition-all shadow-sm group"
                >
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-medium text-gray-100 text-sm group-hover:text-indigo-400 transition-colors">{item.company}</h4>
                    <button className="text-gray-500 hover:text-gray-300">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="text-lg font-bold text-gray-100 mb-3">{item.value}</div>
                  
                  <div className="flex items-center justify-between mt-4">
                    <span className="text-xs text-gray-400 font-medium flex items-center gap-1">
                      <Calendar className="h-3 w-3" /> {item.days} days
                    </span>
                    {item.aiActive && (
                      <span className="flex h-2 w-2 relative" title="AI Negotiator Active">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Modal Dialog */}
      <AnimatePresence>
        {selectedDeal && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedDeal(null)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 flex items-center justify-center p-4"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-[#111827] rounded-xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col border border-gray-800"
              >
                <div className="p-6 border-b border-gray-800 bg-gray-900 flex items-center justify-between">
                  <h2 className="text-xl font-bold text-gray-100">{selectedDeal.company}</h2>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${
                    selectedDeal.intent === 'Hot' ? 'bg-orange-950/50 text-orange-400 border-orange-800' :
                    selectedDeal.intent === 'Warm' ? 'bg-amber-950/50 text-amber-400 border-amber-800' :
                    selectedDeal.intent === 'Won' ? 'bg-emerald-950/50 text-emerald-400 border-emerald-800' :
                    'bg-gray-800 text-gray-300 border-gray-700'
                  }`}>
                    {selectedDeal.intent} Lead
                  </span>
                </div>
                
                <div className="p-6 space-y-6">
                  <div className="flex gap-4">
                    <div className="flex-1 bg-gray-900/50 p-4 rounded-lg border border-gray-800">
                      <p className="text-xs text-gray-400 font-medium flex items-center gap-1"><DollarSign className="h-3 w-3"/> Deal Value</p>
                      <p className="text-xl font-bold text-gray-100 mt-1">{selectedDeal.value}</p>
                    </div>
                    <div className="flex-1 bg-gray-900/50 p-4 rounded-lg border border-gray-800">
                      <p className="text-xs text-gray-400 font-medium flex items-center gap-1"><Mail className="h-3 w-3"/> Last Contact</p>
                      <p className="text-lg font-semibold text-gray-100 mt-1">{selectedDeal.lastContact}</p>
                    </div>
                  </div>

                  {selectedDeal.aiActive && (
                    <div className="p-4 bg-indigo-950/30 border border-indigo-900/50 rounded-lg">
                      <h4 className="text-sm font-semibold text-indigo-400 mb-2">AI Negotiation (W12) is active</h4>
                      <p className="text-xs text-indigo-200">The agent sent a follow-up 1 hour ago addressing pricing objections. Waiting for prospect response.</p>
                    </div>
                  )}

                  <div>
                    <label className="text-sm font-medium text-gray-300">Add Note</label>
                    <textarea 
                      className="w-full mt-1 border border-gray-700 bg-gray-800 rounded-md p-2 text-sm text-gray-100 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none" 
                      rows={3} 
                      placeholder="Type a manual note..."
                    />
                  </div>
                </div>
                
                <div className="p-4 bg-gray-900 border-t border-gray-800 flex justify-end gap-3">
                  <Button variant="outline" onClick={() => setSelectedDeal(null)}>Cancel</Button>
                  <Button className="bg-indigo-600 hover:bg-indigo-700 text-white">Save Details</Button>
                </div>
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
