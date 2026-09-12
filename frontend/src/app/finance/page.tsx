"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CreditCard, Download, TrendingUp, DollarSign, FileText, RefreshCw, AlertCircle } from "lucide-react";
import { motion } from "motion/react";
import { dashboardAPI } from "@/lib/api";

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);
}

function formatDate(d: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function FinancePage() {
  const [finance, setFinance] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dashboardAPI.getFinance()
      .then(data => setFinance(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const payments: any[] = finance?.payments || [];
  const totalRevenue: number = finance?.totalRevenue || 0;
  const pendingRevenue: number = finance?.pendingRevenue || 0;
  const netMargin: number = finance?.netMargin || 0;

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-gray-100 flex items-center gap-3">
            Finance & Analytics
            <CreditCard className="h-5 w-5 text-emerald-400" />
          </h1>
          <p className="text-gray-400 text-sm">Verified revenue, invoices, and W14 Revenue Analytics.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" className="gap-2" disabled>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <RefreshCw className="h-8 w-8 animate-spin text-indigo-400" />
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid gap-6 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-400">Total Verified Revenue</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-emerald-400">{formatCurrency(totalRevenue)}</div>
                {pendingRevenue > 0 && (
                  <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" />
                    {formatCurrency(pendingRevenue)} pending
                  </p>
                )}
                {totalRevenue === 0 && (
                  <p className="text-xs text-gray-600 mt-1">No verified payments yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-400">Pending Receivables</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-gray-100">{formatCurrency(pendingRevenue)}</div>
                <p className={`text-xs mt-1 flex items-center gap-1 ${pendingRevenue > 0 ? 'text-amber-400' : 'text-gray-600'}`}>
                  <AlertCircle className="h-3 w-3" />
                  {pendingRevenue > 0 ? 'Awaiting verification (W14)' : 'No pending payments'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-400">Net Profit Margin</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-gray-100">
                  {totalRevenue > 0 ? `${netMargin.toFixed(1)}%` : '—'}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {totalRevenue > 0 ? 'SaaS infrastructure costs only' : 'No revenue recorded yet'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Payments Table */}
          <Card>
            <CardHeader className="border-b border-gray-800 bg-gray-900/50">
              <CardTitle className="text-gray-100 flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-emerald-400" />
                Payment Records
              </CardTitle>
              <CardDescription>Automatically reconciled by W14. {payments.length} records found.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {payments.length === 0 ? (
                <div className="p-12 text-center text-gray-600">
                  <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p className="font-medium text-gray-400">No payment records yet</p>
                  <p className="text-sm mt-1">Revenue will appear here once W14 closes deals.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-gray-400 bg-gray-900 sticky top-0 uppercase font-semibold border-b border-gray-800">
                      <tr>
                        <th className="px-6 py-4">Payment ID</th>
                        <th className="px-6 py-4">Opportunity</th>
                        <th className="px-6 py-4">Amount</th>
                        <th className="px-6 py-4">Currency</th>
                        <th className="px-6 py-4">Date</th>
                        <th className="px-6 py-4">Provider</th>
                        <th className="px-6 py-4 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800 text-gray-300 bg-[#111827]">
                      {payments.map((payment: any, i: number) => (
                        <motion.tr
                          key={payment._id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                          className="hover:bg-indigo-950/30 transition-colors cursor-pointer"
                        >
                          <td className="px-6 py-4 font-mono text-xs text-gray-400">{payment.payment_id}</td>
                          <td className="px-6 py-4 font-medium text-gray-100">{payment.opportunity_id}</td>
                          <td className="px-6 py-4 font-bold text-gray-100">{formatCurrency(payment.amount)}</td>
                          <td className="px-6 py-4">{payment.currency || 'USD'}</td>
                          <td className="px-6 py-4 text-gray-400">{formatDate(payment.createdAt)}</td>
                          <td className="px-6 py-4 text-gray-400">{payment.provider}</td>
                          <td className="px-6 py-4 text-right">
                            <span className={`px-2.5 py-1 rounded text-xs font-semibold border ${
                              ['completed', 'verified'].includes(payment.status)
                                ? 'bg-emerald-950/50 text-emerald-400 border-emerald-800'
                                : 'bg-amber-950/50 text-amber-400 border-amber-800'
                            }`}>
                              {payment.status}
                            </span>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
