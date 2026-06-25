
'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  FileText, Upload, CheckCircle, AlertTriangle, Clock,
  TrendingUp, X, ChevronRight, RefreshCw, DollarSign,
  Zap, Shield, Eye
} from 'lucide-react'
import type { Invoice } from '@/lib/dynamodb'

interface Stats {
  total: number; pending: number; processing: number; matched: number
  discrepancy: number; approved: number; rejected: number; paid: number
  totalValue: number; approvedValue: number; avgConfidence: number; straightThroughRate: number
}

const STATUS_CONFIG: Record<string, { label: string; className: string; icon: any }> = {
  PENDING:     { label: 'Pending',      className: 'status-pending',     icon: Clock },
  PROCESSING:  { label: 'Processing',   className: 'status-processing',  icon: Zap },
  MATCHED:     { label: 'Matched',      className: 'status-matched',     icon: CheckCircle },
  DISCREPANCY: { label: 'Discrepancy',  className: 'status-discrepancy', icon: AlertTriangle },
  APPROVED:    { label: 'Approved',     className: 'status-approved',    icon: CheckCircle },
  REJECTED:    { label: 'Rejected',     className: 'status-rejected',    icon: X },
  PAID:        { label: 'Paid',         className: 'status-paid',        icon: DollarSign },
}

export default function Dashboard() {
  const searchParams = useSearchParams()
  const highlightId = searchParams.get('highlight')

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [selected, setSelected] = useState<Invoice | null>(null)
  const [filter, setFilter] = useState<string>('ALL')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectInput, setShowRejectInput] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const [invRes, statsRes] = await Promise.all([
        fetch('/api/invoices'),
        fetch('/api/stats'),
      ])
      const [invData, statsData] = await Promise.all([invRes.json(), statsRes.json()])
      setInvoices(Array.isArray(invData) ? invData : [])
      setStats(statsData)

      // Auto-select highlighted invoice
      if (highlightId && Array.isArray(invData)) {
        const hi = invData.find((i: Invoice) => i.id === highlightId)
        if (hi) setSelected(hi)
      }
    } finally {
      setLoading(false)
    }
  }, [highlightId])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000) // poll every 5s
    return () => clearInterval(interval)
  }, [fetchData])

  const handleApprove = async () => {
    if (!selected) return
    setActionLoading(true)
    await fetch(`/api/invoices/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'APPROVED', approvedBy: 'dashboard-user' }),
    })
    await fetchData()
    const updated = invoices.find(i => i.id === selected.id)
    if (updated) setSelected({ ...updated, status: 'APPROVED' })
    setActionLoading(false)
  }

  const handleReject = async () => {
    if (!selected) return
    if (!showRejectInput) { setShowRejectInput(true); return }
    setActionLoading(true)
    await fetch(`/api/invoices/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'REJECTED', rejectedReason: rejectReason }),
    })
    setShowRejectInput(false)
    setRejectReason('')
    await fetchData()
    setActionLoading(false)
  }

  const filtered = filter === 'ALL' ? invoices : invoices.filter(i => i.status === filter)

  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)

  return (
    <div className="min-h-screen bg-ink flex flex-col">
      {/* Top nav */}
      <nav className="border-b border-mist/50 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-azure flex items-center justify-center">
            <FileText className="w-3 h-3 text-white" />
          </div>
          <span className="font-display font-bold text-snow">InvoiceFlow AI</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchData} className="btn-ghost flex items-center gap-1.5 text-sm">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <Link href="/upload" className="btn-primary flex items-center gap-2 text-sm">
            <Upload className="w-3.5 h-3.5" /> Upload Invoice
          </Link>
        </div>
      </nav>

      {/* Stats bar */}
      {stats && (
        <div className="border-b border-mist/30 px-6 py-4 grid grid-cols-4 gap-4 flex-shrink-0">
          {[
            { label: 'Total Value', value: fmt(stats.totalValue), icon: DollarSign, color: 'text-azure' },
            { label: 'Needs Review', value: String(stats.discrepancy + stats.pending), icon: AlertTriangle, color: 'text-amber' },
            { label: 'AI Accuracy', value: `${Math.round(stats.avgConfidence * 100)}%`, icon: Shield, color: 'text-cyan' },
            { label: 'Auto-matched', value: `${Math.round(stats.straightThroughRate * 100)}%`, icon: TrendingUp, color: 'text-sage' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="flex items-center gap-3">
              <div className={`p-2 rounded-lg bg-mist`}>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <div>
                <p className="text-xs text-ghost">{label}</p>
                <p className="font-display font-bold text-snow text-lg leading-tight">{value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Invoice list */}
        <div className="w-96 flex-shrink-0 border-r border-mist/30 flex flex-col overflow-hidden">
          {/* Filter tabs */}
          <div className="px-4 py-3 border-b border-mist/30 flex gap-1 flex-wrap">
            {['ALL', 'DISCREPANCY', 'MATCHED', 'PENDING', 'APPROVED'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                  filter === f ? 'bg-azure text-white' : 'bg-mist text-ghost hover:text-snow'
                }`}
              >
                {f === 'ALL' ? `All (${invoices.length})` : f.charAt(0) + f.slice(1).toLowerCase()}
                {f !== 'ALL' && stats && ` (${stats[f.toLowerCase() as keyof Stats] ?? 0})`}
              </button>
            ))}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="space-y-3 p-4">
                {[1,2,3].map(i => (
                  <div key={i} className="h-20 shimmer rounded-xl" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center">
                <FileText className="w-10 h-10 text-ghost/30 mx-auto mb-3" />
                <p className="text-ghost text-sm">No invoices yet.</p>
                <Link href="/upload" className="btn-primary text-sm mt-4 inline-block">
                  Upload your first invoice
                </Link>
              </div>
            ) : (
              filtered.map(inv => {
                const cfg = STATUS_CONFIG[inv.status] || STATUS_CONFIG.PENDING
                const StatusIcon = cfg.icon
                const isHighlighted = inv.id === highlightId
                return (
                  <button
                    key={inv.id}
                    onClick={() => setSelected(inv)}
                    className={`w-full text-left px-4 py-3 border-b border-mist/20 hover:bg-mist/30 transition-colors ${
                      selected?.id === inv.id ? 'bg-mist/50 border-l-2 border-l-azure' : ''
                    } ${isHighlighted ? 'ring-1 ring-azure/30' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-snow text-sm truncate">{inv.vendorName}</p>
                        <p className="text-xs text-ghost font-mono truncate">{inv.invoiceNumber}</p>
                      </div>
                      <span className={cfg.className}>
                        <StatusIcon className="w-3 h-3" />
                        {cfg.label}
                      </span>
                    </div>
                    <div className="flex justify-between mt-2 text-xs">
                      <span className="text-ghost">{new Date(inv.uploadedAt).toLocaleDateString()}</span>
                      <span className="text-snow font-semibold">{fmt(inv.totalAmount)}</span>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Detail panel */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selected ? (
            <div className="h-full flex items-center justify-center text-center">
              <div>
                <Eye className="w-12 h-12 text-ghost/20 mx-auto mb-4" />
                <p className="text-ghost">Select an invoice to review</p>
              </div>
            </div>
          ) : (
            <div className="max-w-2xl space-y-6 animate-fade-in">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-display text-2xl font-bold text-snow">{selected.vendorName}</h2>
                  <p className="text-ghost font-mono text-sm mt-1">{selected.invoiceNumber}</p>
                </div>
                <div className="text-right">
                  <p className="font-display text-3xl font-bold text-snow">{fmt(selected.totalAmount)}</p>
                  <p className="text-ghost text-xs mt-1">AI confidence: {Math.round(selected.aiConfidence * 100)}%</p>
                </div>
              </div>

              {/* Status + dates */}
              <div className="card grid grid-cols-3 gap-4">
                <div>
                  <p className="text-ghost text-xs mb-1">Status</p>
                  <span className={STATUS_CONFIG[selected.status]?.className || 'badge bg-ghost/20 text-ghost'}>
                    {STATUS_CONFIG[selected.status]?.label || selected.status}
                  </span>
                </div>
                <div>
                  <p className="text-ghost text-xs mb-1">Invoice Date</p>
                  <p className="text-snow text-sm font-medium">{selected.invoiceDate}</p>
                </div>
                <div>
                  <p className="text-ghost text-xs mb-1">Due Date</p>
                  <p className="text-snow text-sm font-medium">{selected.dueDate}</p>
                </div>
              </div>

              {/* PO match */}
              <div className="card">
                <p className="text-ghost text-xs font-semibold uppercase tracking-wider mb-3">PO Match</p>
                {selected.matchedPOId ? (
                  <div className="flex items-center gap-2 text-sage">
                    <CheckCircle className="w-4 h-4" />
                    <span className="text-sm font-medium">Matched to PO {selected.matchedPOId.slice(0, 8)}...</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-amber">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-sm">No matching PO found — manual review required</span>
                  </div>
                )}
              </div>

              {/* Discrepancies */}
              {selected.discrepancies && selected.discrepancies.length > 0 && (
                <div className="card border-rose/20">
                  <p className="text-rose text-xs font-semibold uppercase tracking-wider mb-3">
                    Discrepancies ({selected.discrepancies.length})
                  </p>
                  <div className="space-y-2">
                    {selected.discrepancies.map((d, i) => (
                      <div key={i} className="flex items-center justify-between bg-rose/5 rounded-lg px-4 py-2.5">
                        <div>
                          <p className="text-snow text-sm font-medium">{d.field}</p>
                          <p className="text-ghost text-xs">Invoice: {d.invoiceValue} · PO: {d.poValue}</p>
                        </div>
                        <span className={`badge ${
                          d.severity === 'HIGH' ? 'bg-rose/20 text-rose' :
                          d.severity === 'MEDIUM' ? 'bg-amber/20 text-amber' :
                          'bg-ghost/20 text-ghost'
                        }`}>
                          {d.severity}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Line items */}
              {selected.lineItems.length > 0 && (
                <div className="card">
                  <p className="text-ghost text-xs font-semibold uppercase tracking-wider mb-3">Line Items</p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-ghost text-xs border-b border-mist">
                        <th className="text-left pb-2">Description</th>
                        <th className="text-right pb-2">Qty</th>
                        <th className="text-right pb-2">Unit</th>
                        <th className="text-right pb-2">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.lineItems.map((item, i) => (
                        <tr key={i} className="border-b border-mist/30 last:border-0">
                          <td className="py-2 text-snow pr-4">{item.description}</td>
                          <td className="py-2 text-right text-ghost">{item.quantity}</td>
                          <td className="py-2 text-right text-ghost">{fmt(item.unitPrice)}</td>
                          <td className="py-2 text-right text-snow font-medium">{fmt(item.total)}</td>
                        </tr>
                      ))}
                      <tr className="font-bold">
                        <td colSpan={3} className="pt-3 text-ghost text-xs uppercase tracking-wider">Total</td>
                        <td className="pt-3 text-right text-azure text-lg">{fmt(selected.totalAmount)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {/* Actions */}
              {['MATCHED', 'DISCREPANCY', 'PENDING'].includes(selected.status) && (
                <div className="card border-mist space-y-3">
                  <p className="text-ghost text-xs font-semibold uppercase tracking-wider">Decision</p>
                  {showRejectInput && (
                    <textarea
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      placeholder="Reason for rejection (optional)..."
                      className="input h-20 resize-none text-sm"
                    />
                  )}
                  <div className="flex gap-3">
                    <button
                      onClick={handleApprove}
                      disabled={actionLoading}
                      className="btn-primary flex-1 flex items-center justify-center gap-2"
                    >
                      <CheckCircle className="w-4 h-4" /> Approve
                    </button>
                    <button
                      onClick={handleReject}
                      disabled={actionLoading}
                      className="bg-rose/10 hover:bg-rose/20 text-rose border border-rose/20 font-semibold px-5 py-2.5 rounded-lg transition-all flex-1 flex items-center justify-center gap-2"
                    >
                      <X className="w-4 h-4" /> {showRejectInput ? 'Confirm Reject' : 'Reject'}
                    </button>
                  </div>
                </div>
              )}

              {selected.status === 'APPROVED' && (
                <div className="card border-sage/20 flex items-center gap-3">
                  <CheckCircle className="w-6 h-6 text-sage" />
                  <div>
                    <p className="text-snow font-semibold">Approved</p>
                    <p className="text-ghost text-sm">By {selected.approvedBy} · {selected.approvedAt ? new Date(selected.approvedAt).toLocaleString() : ''}</p>
                  </div>
                </div>
              )}

              {selected.status === 'REJECTED' && (
                <div className="card border-rose/20 flex items-start gap-3">
                  <X className="w-6 h-6 text-rose mt-0.5" />
                  <div>
                    <p className="text-snow font-semibold">Rejected</p>
                    {selected.rejectedReason && <p className="text-ghost text-sm mt-1">{selected.rejectedReason}</p>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
