'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Upload, FileText, ArrowLeft, CheckCircle, Loader2, AlertCircle, X } from 'lucide-react'

type UploadState = 'idle' | 'uploading' | 'processing' | 'done' | 'error'

export default function UploadPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<UploadState>('idle')
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [result, setResult] = useState<{ id: string; invoiceNumber: string; status: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)

  const handleFile = useCallback((f: File) => {
    if (!f.type.includes('pdf') && !f.type.includes('image')) {
      setError('Please upload a PDF or image file.')
      return
    }
    if (f.size > 10 * 1024 * 1024) {
      setError('File must be under 10MB.')
      return
    }
    setFile(f)
    setError(null)
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }

  const handleUpload = async () => {
    if (!file) return
    setState('uploading')
    setProgress(0)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      // Simulate progress during upload
      const progressInterval = setInterval(() => {
        setProgress(p => Math.min(p + 10, 60))
      }, 200)

      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      clearInterval(progressInterval)

      if (!uploadRes.ok) {
        const err = await uploadRes.json()
        throw new Error(err.error || 'Upload failed')
      }

      const { invoiceId } = await uploadRes.json()
      setState('processing')
      setProgress(65)

      // Poll for processing completion
      let attempts = 0
      while (attempts < 30) {
        await new Promise(r => setTimeout(r, 1000))
        setProgress(p => Math.min(p + 2, 95))

        const statusRes = await fetch(`/api/invoices/${invoiceId}`)
        if (statusRes.ok) {
          const invoice = await statusRes.json()
          if (invoice.status !== 'PROCESSING' && invoice.status !== 'PENDING') {
            setProgress(100)
            setState('done')
            setResult({ id: invoiceId, invoiceNumber: invoice.invoiceNumber, status: invoice.status })
            return
          }
        }
        attempts++
      }

      throw new Error('Processing timed out. Please check the dashboard.')
    } catch (e: any) {
      setState('error')
      setError(e.message || 'Something went wrong.')
    }
  }

  const reset = () => {
    setState('idle')
    setFile(null)
    setResult(null)
    setError(null)
    setProgress(0)
  }

  const statusLabel: Record<string, string> = {
    MATCHED: 'Auto-matched to a PO — ready for approval',
    DISCREPANCY: 'Discrepancies found — needs review',
    PENDING: 'Queued for processing',
  }

  return (
    <div className="min-h-screen bg-ink">
      <nav className="border-b border-mist/50 px-6 py-4 flex items-center gap-4">
        <Link href="/" className="btn-ghost flex items-center gap-2 text-sm">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-azure flex items-center justify-center">
            <FileText className="w-3 h-3 text-white" />
          </div>
          <span className="font-display font-bold text-snow">InvoiceFlow AI</span>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-16">
        <h1 className="font-display text-4xl font-bold text-snow mb-2">Upload Invoice</h1>
        <p className="text-ghost mb-10">PDF or image. Our AI handles the rest.</p>

        {state === 'done' && result ? (
          <div className="card border-sage/30 animate-fade-in">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle className="w-8 h-8 text-sage" />
              <div>
                <h2 className="font-display font-bold text-xl text-snow">Processed!</h2>
                <p className="text-ghost text-sm">Invoice {result.invoiceNumber}</p>
              </div>
            </div>
            <div className="bg-mist rounded-lg p-4 mb-6">
              <p className="text-sm text-snow">
                {statusLabel[result.status] || `Status: ${result.status}`}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => router.push(`/dashboard?highlight=${result.id}`)}
                className="btn-primary flex-1"
              >
                View in Dashboard
              </button>
              <button onClick={reset} className="btn-secondary flex-1">
                Upload Another
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Drop zone */}
            <div
              onDrop={onDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => state === 'idle' && fileInputRef.current?.click()}
              className={`
                relative border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-200 cursor-pointer
                ${dragOver ? 'border-azure bg-azure/5 scale-[1.01]' : 'border-mist hover:border-azure/50 hover:bg-mist/30'}
                ${file ? 'border-sage/40 bg-sage/5' : ''}
                ${state !== 'idle' ? 'pointer-events-none' : ''}
              `}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,image/*"
                className="hidden"
                onChange={onFileChange}
              />

              {file ? (
                <div className="space-y-3">
                  <FileText className="w-12 h-12 text-sage mx-auto" />
                  <div>
                    <p className="font-semibold text-snow">{file.name}</p>
                    <p className="text-ghost text-sm">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                  {state === 'idle' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); reset() }}
                      className="text-ghost hover:text-rose transition-colors"
                    >
                      <X className="w-4 h-4 mx-auto" />
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <Upload className="w-12 h-12 text-ghost mx-auto" />
                  <div>
                    <p className="text-snow font-semibold">Drop your invoice here</p>
                    <p className="text-ghost text-sm mt-1">or click to browse — PDF or image, max 10MB</p>
                  </div>
                </div>
              )}
            </div>

            {/* Progress bar */}
            {(state === 'uploading' || state === 'processing') && (
              <div className="mt-6 animate-fade-in">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-ghost flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {state === 'uploading' ? 'Uploading...' : 'AI extracting data...'}
                  </span>
                  <span className="text-azure font-mono">{progress}%</span>
                </div>
                <div className="h-1.5 bg-mist rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-azure to-cyan rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="mt-3 space-y-1">
                  {['File received', 'Extracting text', 'AI parsing fields', 'Matching to POs'].map((step, i) => (
                    <div key={step} className={`text-xs flex items-center gap-2 transition-colors ${
                      progress > i * 25 ? 'text-sage' : 'text-ghost/30'
                    }`}>
                      <CheckCircle className="w-3 h-3" />
                      {step}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="mt-4 flex items-start gap-3 bg-rose/10 border border-rose/20 rounded-lg p-4 animate-fade-in">
                <AlertCircle className="w-5 h-5 text-rose flex-shrink-0 mt-0.5" />
                <p className="text-rose text-sm">{error}</p>
              </div>
            )}

            {/* Upload button */}
            {file && state === 'idle' && (
              <button
                onClick={handleUpload}
                className="btn-primary w-full mt-6 py-3 text-base flex items-center justify-center gap-2"
              >
                <Zap className="w-4 h-4" />
                Process Invoice
              </button>
            )}
          </>
        )}

        {/* Info cards */}
        <div className="grid grid-cols-3 gap-4 mt-10">
          {[
            { label: 'Auto-extraction', desc: 'Vendor, amounts, line items' },
            { label: 'PO matching', desc: 'Automatic + discrepancy flags' },
            { label: 'Audit trail', desc: 'Every action logged in DynamoDB' },
          ].map(({ label, desc }) => (
            <div key={label} className="bg-slate rounded-lg p-3 text-center">
              <p className="text-xs font-semibold text-azure mb-1">{label}</p>
              <p className="text-xs text-ghost">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Zap({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}
