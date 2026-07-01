import Link from 'next/link'
import { ArrowRight, Zap, Shield, TrendingUp, FileText, CheckCircle, AlertTriangle } from 'lucide-react'

export default function Home() {
  return (
    <main className="min-h-screen bg-ink overflow-hidden">
      {/* Nav */}
      <nav className="border-b border-mist/50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-azure flex items-center justify-center">
            <FileText className="w-4 h-4 text-white" />
          </div>
          <span className="font-display font-bold text-xl text-snow">InvoiceFlow AI</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="btn-ghost text-sm">Dashboard</Link>
          <Link href="/upload" className="btn-primary text-sm">Try it free</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-24 pb-20 text-center">
        {/* Live indicator */}
        <div className="inline-flex items-center gap-2 bg-sage/10 border border-sage/20 rounded-full px-4 py-1.5 mb-8">
          <span className="w-2 h-2 rounded-full bg-sage animate-pulse-slow" />
          <span className="text-sage text-sm font-medium">Powered by AWS DynamoDB + AI</span>
        </div>

        <h1 className="font-display text-5xl md:text-7xl font-bold text-snow leading-[1.05] mb-6">
          Invoice approval
          <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-azure via-cyan to-sage">
            in seconds, not days.
          </span>
        </h1>

        <p className="text-ghost text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
          Upload any invoice. Our AI extracts every field, matches it to your purchase orders,
          flags discrepancies, and routes it for approval — automatically.
        </p>

        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Link href="/upload" className="btn-primary flex items-center gap-2 text-base px-8 py-3">
            Process an invoice <ArrowRight className="w-4 h-4" />
          </Link>
          <Link href="/dashboard" className="btn-secondary text-base px-8 py-3">
            View dashboard
          </Link>
        </div>

        {/* Stats row */}
        <div className="mt-20 grid grid-cols-3 gap-8 max-w-2xl mx-auto">
          {[
            { value: '< 8s', label: 'avg processing time' },
            { value: '94%', label: 'extraction accuracy' },
            { value: '73%', label: 'straight-through rate' },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="font-display text-3xl font-bold text-azure mb-1">{stat.value}</div>
              <div className="text-ghost text-sm">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-mist/30">
        <h2 className="font-display text-3xl font-bold text-center mb-16">
          From PDF to payment in 4 steps
        </h2>
        <div className="grid md:grid-cols-4 gap-6">
          {[
            { icon: FileText, title: 'Upload', desc: 'Drop a PDF or image invoice. Any format, any vendor.', color: 'text-azure' },
            { icon: Zap, title: 'Extract', desc: 'AI reads every field: amounts, line items, dates, vendor details.', color: 'text-cyan' },
            { icon: Shield, title: 'Match & Verify', desc: 'Auto-matched to your POs. Discrepancies flagged instantly.', color: 'text-amber' },
            { icon: CheckCircle, title: 'Approve', desc: 'One-click approval or rejection with a full audit trail.', color: 'text-sage' },
          ].map((step, i) => (
            <div key={step.title} className="card-hover relative">
              <div className="text-xs font-mono text-ghost/50 mb-4">0{i + 1}</div>
              <step.icon className={`w-6 h-6 ${step.color} mb-3`} />
              <h3 className="font-display font-semibold text-lg mb-2">{step.title}</h3>
              <p className="text-ghost text-sm leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature highlights */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-mist/30">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="font-display text-3xl font-bold mb-6">
              Every discrepancy caught,<br />every approval tracked.
            </h2>
            <ul className="space-y-4">
              {[
                { icon: CheckCircle, text: 'PO matching with configurable tolerance thresholds', color: 'text-sage' },
                { icon: AlertTriangle, text: 'Automatic discrepancy detection with severity levels', color: 'text-amber' },
                { icon: Shield, text: 'Human-in-the-loop approval for flagged invoices', color: 'text-azure' },
                { icon: TrendingUp, text: 'Full audit trail stored in AWS DynamoDB', color: 'text-cyan' },
              ].map(({ icon: Icon, text, color }) => (
                <li key={text} className="flex items-start gap-3">
                  <Icon className={`w-5 h-5 ${color} mt-0.5 flex-shrink-0`} />
                  <span className="text-ghost">{text}</span>
                </li>
              ))}
            </ul>
            <Link href="/upload" className="btn-primary inline-flex items-center gap-2 mt-8">
              Start processing <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {/* Mock invoice card */}
          <div className="card border-azure/20 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-xs text-ghost">INVOICE #2026-0842</span>
              <span className="status-discrepancy">Discrepancy</span>
            </div>
            <div className="border-t border-mist pt-4 space-y-3">
              {[
                { label: 'Vendor', value: 'Acme Software Solutions' },
                { label: 'Amount', value: '$12,750.00', highlight: true },
                { label: 'PO Total', value: '$12,500.00' },
                { label: 'Difference', value: '+$250.00', warn: true },
              ].map(({ label, value, highlight, warn }) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-ghost">{label}</span>
                  <span className={highlight ? 'text-snow font-semibold' : warn ? 'text-rose font-semibold' : 'text-snow'}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <button className="btn-primary flex-1 py-2 text-sm">Approve anyway</button>
              <button className="btn-secondary flex-1 py-2 text-sm">Reject</button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-mist/30 px-6 py-8 text-center text-ghost text-sm">
        <p>Built for H0 Hackathon — Vercel + AWS DynamoDB stack</p>
      </footer>
    </main>
  )
}