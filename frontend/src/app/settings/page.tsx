"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import { Settings, Save, Server, Mail, ShieldAlert, User, Bell } from "lucide-react";
import { useState, useEffect } from "react";
import { dashboardAPI } from "@/lib/api";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('engine');
  const [config, setConfig] = useState<any>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    dashboardAPI.getConfig().then(configs => {
      const configMap: any = {};
      configs.forEach((c: any) => {
        configMap[c.config_key] = c.config_value;
      });
      setConfig(configMap);
    }).catch(console.error);
  }, []);

  const handleSave = async (key: string, value: string) => {
    setIsSaving(true);
    try {
      await dashboardAPI.updateConfig({ key, value });
      setConfig((prev: any) => ({ ...prev, [key]: value }));
    } catch (e) {
      console.error("Failed to save config", e);
    }
    setIsSaving(false);
  };

  return (
    <div className="space-y-6 pb-10 h-full flex flex-col max-w-6xl mx-auto w-full">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-gray-100 flex items-center gap-2">
          Engine Config
          <Settings className="h-5 w-5 text-gray-500" />
        </h1>
        <p className="text-gray-400 text-sm">Direct interface for the `vynora_config` database table.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-8 items-start mt-6">
        {/* Settings Sidebar */}
        <div className="w-full md:w-64 flex-shrink-0 space-y-1 bg-[#111827] p-2 rounded-xl border border-gray-800 shadow-sm">
          <button 
            onClick={() => setActiveTab('engine')}
            className={`w-full text-left px-3 py-2 text-sm font-medium rounded-lg flex items-center gap-3 transition-colors ${activeTab === 'engine' ? 'bg-indigo-950/50 text-indigo-400' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'}`}
          >
            <Server className="h-4 w-4" /> Core Engine
          </button>
          <button 
            onClick={() => setActiveTab('notifications')}
            className={`w-full text-left px-3 py-2 text-sm font-medium rounded-lg flex items-center gap-3 transition-colors ${activeTab === 'notifications' ? 'bg-indigo-950/50 text-indigo-400' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'}`}
          >
            <Bell className="h-4 w-4" /> Notifications
          </button>
          <button 
            onClick={() => setActiveTab('account')}
            className={`w-full text-left px-3 py-2 text-sm font-medium rounded-lg flex items-center gap-3 transition-colors ${activeTab === 'account' ? 'bg-indigo-950/50 text-indigo-400' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'}`}
          >
            <User className="h-4 w-4" /> Account
          </button>
        </div>

        {/* Settings Content */}
        <div className="flex-1 space-y-6 w-full">
          {activeTab === 'engine' && (
            <>
              <Card>
                <CardHeader className="border-b border-gray-800 bg-gray-900/50">
                  <CardTitle className="text-gray-100">Core Engine Parameters</CardTitle>
                  <CardDescription>Adjust the daily operating limits for the AI agent.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 pt-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-gray-300">Daily Email Cap (W01)</label>
                      <input 
                        type="number" 
                        value={config['daily_email_cap'] || 25}
                        onChange={(e) => setConfig({...config, daily_email_cap: e.target.value})}
                        className="w-full bg-gray-900 border border-gray-700 rounded-md py-2 px-3 text-gray-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm"
                      />
                      <p className="text-xs text-gray-500">Maximum outbound emails allowed per day.</p>
                      <Button variant="outline" size="sm" onClick={() => handleSave('daily_email_cap', config['daily_email_cap'])}>Save Config</Button>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-gray-300">Sourcing Grid Size (W10)</label>
                      <select 
                        value={config['sourcing_grid_size'] || 200}
                        onChange={(e) => setConfig({...config, sourcing_grid_size: e.target.value})}
                        className="w-full bg-gray-900 border border-gray-700 rounded-md py-2 px-3 text-gray-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm"
                      >
                        <option value={100}>100 Businesses / Shift</option>
                        <option value={200}>200 Businesses / Shift</option>
                        <option value={500}>500 Businesses / Shift</option>
                      </select>
                      <p className="text-xs text-gray-500">Target batch size for scraping.</p>
                      <Button variant="outline" size="sm" onClick={() => handleSave('sourcing_grid_size', config['sourcing_grid_size'])}>Save Config</Button>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="bg-gray-900/50 border-t border-gray-800 py-4 justify-end">
                  <Button className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm">
                    <Save className="h-4 w-4 mr-2" /> Save Changes
                  </Button>
                </CardFooter>
              </Card>

              <div className="p-5 border border-red-900/50 bg-red-950/20 rounded-xl flex items-start gap-4">
                <ShieldAlert className="h-6 w-6 text-red-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-semibold text-red-400 mb-1">Danger Zone</h4>
                  <p className="text-sm text-red-300/80 mb-4">Actions here can irreversibly affect the AI engine and wipe queued data.</p>
                  <Button 
                    variant="destructive" 
                    size="sm" 
                    className="bg-red-600 hover:bg-red-700 shadow-sm text-white transition-all"
                    onClick={async () => {
                      if (confirm("Are you sure you want to purge the queue? All qualified leads will be marked as purged and will not be contacted.")) {
                        try {
                          await dashboardAPI.purgeOutreachQueue();
                          alert("Queue purged successfully.");
                        } catch (e) {
                          alert("Failed to purge queue.");
                        }
                      }
                    }}
                  >
                    Purge Priority Queue
                  </Button>
                </div>
              </div>
            </>
          )}

          {activeTab === 'notifications' && (
            <Card>
              <CardHeader className="border-b border-gray-800 bg-gray-900/50">
                <CardTitle className="text-gray-100">Communication Settings</CardTitle>
                <CardDescription>Manage where reports and alerts are sent.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                <div className="p-4 border border-indigo-900/50 bg-indigo-950/20 rounded-xl mb-4 text-sm text-indigo-200">
                  <p><strong>Note:</strong> Email destinations are now securely managed via the backend `.env` file for security. Please edit `backend/.env` directly to change these.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-gray-300">Alert Email (ALERT_EMAIL)</label>
                    <input 
                      type="text" 
                      value="Hidden for security (Loaded from .env)"
                      disabled
                      className="w-full bg-gray-900/50 border border-gray-800 rounded-md py-2 px-3 text-gray-500 cursor-not-allowed text-sm"
                    />
                    <p className="text-xs text-gray-500">Receives high-severity errors immediately.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-gray-300">Report Email (REPORT_EMAIL)</label>
                    <input 
                      type="text" 
                      value="Hidden for security (Loaded from .env)"
                      disabled
                      className="w-full bg-gray-900/50 border border-gray-800 rounded-md py-2 px-3 text-gray-500 cursor-not-allowed text-sm"
                    />
                    <p className="text-xs text-gray-500">Receives the full 8-hour shift summary.</p>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="bg-gray-900/50 border-t border-gray-800 py-4 justify-end">
                <Button className="bg-indigo-600/50 text-white/50 shadow-sm cursor-not-allowed" disabled>
                  Locked (.env)
                </Button>
              </CardFooter>
            </Card>
          )}

          {activeTab === 'account' && (
            <Card>
              <CardHeader className="border-b border-gray-800 bg-gray-900/50">
                <CardTitle className="text-gray-100">Account Profile</CardTitle>
                <CardDescription>Manage your administrator profile and access.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                <div className="flex items-center gap-6 pb-6 border-b border-gray-800">
                  <div className="h-20 w-20 rounded-full bg-indigo-900/50 border-2 border-indigo-500 flex items-center justify-center text-indigo-400 text-2xl font-bold shadow-lg">
                    VA
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-100">Vynora Admin</h3>
                    <p className="text-sm text-gray-400">System Administrator</p>
                    <div className="mt-2 flex gap-2">
                      <Button variant="outline" size="sm" className="h-8">Change Avatar</Button>
                      <Button variant="ghost" size="sm" className="h-8 text-red-400 hover:text-red-300">Remove</Button>
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-gray-300">Full Name</label>
                    <input 
                      type="text" 
                      defaultValue="Vynora Admin"
                      className="w-full bg-gray-900 border border-gray-700 rounded-md py-2 px-3 text-gray-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-gray-300">Email Address</label>
                    <input 
                      type="email" 
                      defaultValue="admin@vynora.ai"
                      className="w-full bg-gray-900 border border-gray-700 rounded-md py-2 px-3 text-gray-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm"
                    />
                  </div>
                </div>
              </CardContent>
              <CardFooter className="bg-gray-900/50 border-t border-gray-800 py-4 justify-end">
                <Button className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm">
                  Update Profile
                </Button>
              </CardFooter>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
