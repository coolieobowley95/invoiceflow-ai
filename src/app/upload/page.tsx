'use client'

/**
 * Upload page — async/polling architecture.
 *
 * Flow:
 *  1. User drops/selects a file → handleFile()
 *  2. User clicks "Process Invoice" → handleSubmit()
 *  3. POST /api/upload → returns { invoiceId } in ~300 ms (202 Accepted)
 *  4. setJobId() (validated) triggers useJobPolling(invoiceId) in a useEffect
 *  5. UI transitions through stages as the backend updates the DB
 *  6. Terminal state → success card or soft error with dashboard CTA
 *
 * Safe-exit:
 *  - The "<- Back" link (and any safe-exit trigger) resets all transient state
 *    (file, jobId, errorMsg, doneResult) and clears `phase` to 'idle' BEFORE
 *    navigating away. This prevents the polling hook from continuing with a
 *    stale jobId reference if the user re-mounts the page.
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileText, ArrowLeft, CheckCircle, AlertCircle, X, LayoutDashboard } from 'lucide-react'
import { useJobPolling, type ProcessingStage, type JobStatusResponse } from '@/hooks/useJobPolling'

// ---------------------------------------------------------------------------
// Stage metadata — order, labels, and descriptions shown in the UI timeline
// ---------------------------------------------------------------------------
const STAGES: { key: ProcessingStage; label: string; desc: string }[] = [
  { key: 'QUEUED',          label: 'File received',      desc: 'Securely uploaded to processing queue' },
  { key: 'EXTRACTING_TEXT', label: 'Extracting text',    desc: 'Reading document structure & content' },
  { key: 'PARSING_FIELDS',  label: 'AI parsing fields',  desc: 'Identifying vendor, amounts, line items' },
  { key: 'MATCHING_PO',     label: 'Matching to PO',     desc: 'Searching purchase order database' },
  { key: 'COMPLETE',        label: 'Complete',            desc: 'Invoice processed and ready for review' },
]

const STAGE_ORDER: ProcessingStage[] = STAGES.map(s => s.key)

function stageIndex(stage: ProcessingStage) {
  return STAGE_ORDER.indexOf(stage)
}

const STATUS_COPY: Record<string, { label: string; color: string }> = {
  MATCHED:     { label: 'Matched to a PO — ready for approval', color: 'text-sage' },
  DISCREPANCY: { label: 'Discrepancies found — needs review',   color: 'text-amber' },
  PENDING:     { label: 'Logged — awaiting manual assignment',  color: 'text-ghost' },
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function DropZone({
  file,
  dragOver,
  disabled,
  onDrop,
  onDragOver,
  onDragLeave,
  onClick,
  onRemove,
}: {
  file: File | null
  dragOver: boolean
  disabled: boolean
  onDrop: (e: React.DragEvent) => void
  onDragOver: () => void
  onDragLeave: () => void
  onClick: () => void
  onRemove: () => void
}) {
  return (
    <div
      onDrop={onDrop}
      onDragOver={e => { e.preventDefault(); onDragOver() }}
      onDragLeave={onDragLeave}
      onClick={!disabled ? onClick : undefined}
      className={`
        relative border-2 border-dashed rounded-2xl p-10 text-center transition-all duration-200
        ${!disabled ? 'cursor-pointer' : 'cursor-default'}
        ${dragOver ? 'border-azure bg-azure/5 scale-[1.01]' : 'border-mist'}
        ${file && !disabled ? 'border-sage/40 bg-sage/5' : ''}
        ${!file && !disabled ? 'hover:border-azure/50 hover:bg-mist/20' : ''}
      `}
    >
      {file ? (
        <div className="space-y-3">
          <FileText className="w-12 h-12 text-sage mx-auto" />
          <div>
            <p className="font-semibold text-snow">{file.name}</p>
            <p className="text-ghost text-sm">{(file.size / 1024).toFixed(1)} KB</p>
          </div>
          {!disabled && (
            <button
              onClick={e => { e.stopPropagation(); onRemove() }}
              className="text-ghost hover:text-rose transition-colors mt-1"
              aria-label="Remove file"
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
            <p className="text-ghost text-sm mt-1">or click to browse — PDF or image, max 10 MB</p>
          </div>
        </div>
      )}
    </div>
  )
}

function ProcessingTimeline({ currentStage }: { currentStage: ProcessingStage }) {
  const current = stageIndex(currentStage)

  return (
    <div className="mt-6 space-y-3">
      {STAGES.map((stage, i) => {
        const isDone    = i < current
        const isActive  = i === current
        const isPending = i > current

        return (
          <div
            key={stage.key}
            className={`
              flex items-start gap-3 p-3 rounded-lg transition-all duration-500
              ${isActive  ? 'bg-azure/10 border border-azure/20' : ''}
              ${isDone    ? 'opacity-60' : ''}
              ${isPending ? 'opacity-30' : ''}
            `}
          >
            <div className="flex-shrink-0 mt-0.5">
              {isDone ? (
                <CheckCircle className="w-4 h-4 text-sage" />
              ) : isActive ? (
                <SpinnerIcon className="w-4 h-4 text-azure animate-spin" />
              ) : (
                <div className="w-4 h-4 rounded-full border border-ghost/30" />
              )}
            </div>

            <div>
              <p className={`text-sm font-semibold ${isActive ? 'text-snow' : 'text-ghost'}`}>
                {stage.label}
              </p>
              {isActive && (
                <p className="text-xs text-ghost mt-0.5">{stage.desc}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SuccessCard({
  result,
  onUploadAnother,
}: {
  result: JobStatusResponse
  onUploadAnother: () => void
}) {
  const router = useRouter()
  const copy = STATUS_COPY[result.status] ?? { label: result.status, color: 'text-ghost' }

  return (
    <div className="card border-sage/30 animate-fade-in">
      <div className="flex items-center gap-3 mb-5">
        <CheckCircle className="w-8 h-8 text-sage flex-shrink-0" />
        <div>
          <h2 className="font-display font-bold text-xl text-snow">Processed!</h2>
          <p className="text-ghost text-sm">
            {result.invoiceNumber && result.invoiceNumber !== 'Processing…'
              ? `Invoice ${result.invoiceNumber}`
              : result.vendorName ?? ''}
          </p>
        </div>
      </div>

      <div className="bg-mist rounded-lg p-4 mb-4">
        <p className={`text-sm font-medium ${copy.color}`}>{copy.label}</p>
      </div>

      {result.totalAmount != null && result.totalAmount > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-5">
          <Stat label="Amount" value={`${result.currency ?? 'USD'} ${result.totalAmount.toLocaleString()}`} />
          <Stat label="AI confidence" value={`${Math.round((result.aiConfidence ?? 0) * 100)}%`} />
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => router.push(`/dashboard?highlight=${result.jobId}`)}
          className="btn-primary flex-1 flex items-center justify-center gap-2"
        >
          <LayoutDashboard className="w-4 h-4" />
          View in Dashboard
        </button>
        <button onClick={onUploadAnother} className="btn-secondary flex-1">
          Upload Another
        </button>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate rounded-lg p-3">
      <p className="text-xs text-ghost mb-1">{label}</p>
      <p className="text-sm font-semibold text-snow">{value}</p>
    </div>
  )
}

function ErrorCard({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  const router = useRouter()
  const isTimeout = message.toLowerCase().includes('dashboard')

  return (
    <div className="card border-rose/20 bg-rose/5 animate-fade-in">
      <div className="flex items-start gap-3 mb-4">
        <AlertCircle className="w-5 h-5 text-rose flex-shrink-0 mt-0.5" />
        <p className="text-rose text-sm">{message}</p>
      </div>
      <div className="flex gap-3">
        {isTimeout ? (
          <button
            onClick={() => router.push('/dashboard')}
            className="btn-secondary flex-1 flex items-center justify-center gap-2"
          >
            <LayoutDashboard className="w-4 h-4" />
            Check Dashboard
          </button>
        ) : (
          <button onClick={onRetry} className="btn-primary flex-1">
            Try Again
          </button>
        )}
      </div>
    </div>
  )
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
type UploadPhase = 'idle' | 'uploading' | 'polling' | 'done' | 'error'

export default function UploadPage() {
  const router           = useRouter()
  const fileInputRef     = useRef<HTMLInputElement>(null)
  const [file, setFile]       = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [phase, setPhase]     = useState<UploadPhase>('idle')
  const [jobId, setJobId]     = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [doneResult, setDoneResult] = useState<JobStatusResponse | null>(null)

  // FIX (Process Invoice): The polling hook is now driven directly by jobId.
  // Previously, the hook was gated on `phase === 'polling' ? jobId : null`,
  // which produced a race condition: on the same render where the API
  // response arrived, setJobId(...) and setPhase('polling') were called
  // back-to-back, but the hook observed `null` (because phase was still
  // 'uploading') and never started polling — leading to the
  // "Job not found" error. Letting the hook react to jobId directly
  // removes that race.
  const handlePollingComplete = useCallback((result: JobStatusResponse) => {
    setPhase('done')
    setDoneResult(result)
  }, [])

  const handlePollingError = useCallback((msg: string) => {
    setPhase('error')
    setErrorMsg(msg)
  }, [])

  const pollState = useJobPolling(jobId, {
    onComplete: handlePollingComplete,
    onError: handlePollingError,
  })

  // After the API returns a valid jobId, transition the UI to 'polling'.
  // Doing this in an effect guarantees it happens after the render where
  // jobId is set, so the hook has already kicked off its first poll.
  useEffect(() => {
    if (jobId && phase === 'uploading') {
      setPhase('polling')
    }
  }, [jobId, phase])

  const handleFile = useCallback((f: File) => {
    if (!f.type.includes('pdf') && !f.type.includes('image')) {
      setErrorMsg('Please upload a PDF or image file.')
      setPhase('error')
      return
    }
    if (f.size > 10 * 1024 * 1024) {
      setErrorMsg('File must be under 10 MB.')
      setPhase('error')
      return
    }
    setFile(f)
    setPhase('idle')
    setErrorMsg(null)
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  // FIX (Process Invoice): handleSubmit now:
  //  - guards against re-entry while a request is in flight or polling,
  //  - properly awaits POST /api/upload,
  //  - validates that the response contains a usable invoiceId (string,
  //    non-empty) BEFORE transitioning to the polling state,
  //  - catches network/parse errors and surfaces them via the error card.
  const handleSubmit = async () => {
    if (!file) return
    if (phase === 'uploading' || phase === 'polling') return

    setPhase('uploading')
    setErrorMsg(null)

    try {
      const fd = new FormData()
      fd.append('file', file)

      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const body = await res.json().catch(() => ({} as any))

      if (!res.ok) {
        throw new Error(body?.error || `Upload failed (${res.status})`)
      }

      const newJobId: string | undefined = body?.invoiceId
      if (!newJobId || typeof newJobId !== 'string') {
        throw new Error('Server response missing invoiceId. Please try again.')
      }

      // Set jobId FIRST. useJobPolling observes jobId directly and starts
      // polling on the next render. The useEffect above then flips the
      // phase to 'polling' so the UI shows the processing timeline.
      setJobId(newJobId)
    } catch (e: any) {
      setPhase('error')
      setErrorMsg(e?.message || 'Upload failed. Please try again.')
    }
  }

  // FIX (<- Back button): safeExit clears ALL transient state — most
  // importantly jobId, which causes the polling hook to stop on its next
  // effect tick — and then navigates to the dashboard. This is responsive
  // in every phase (idle, uploading, polling, done, error) and never
  // leaves a hanging promise behind.
  const safeExit = useCallback(() => {
    setPhase('idle')
    setFile(null)
    setJobId(null)
    setErrorMsg(null)
    setDoneResult(null)
    setDragOver(false)
    router.push('/dashboard')
  }, [router])

  // Reset to a fresh upload form (used by inline "Try Again" / "Upload Another")
  const reset = () => {
    setPhase('idle')
    setFile(null)
    setJobId(null)
    setErrorMsg(null)
    setDoneResult(null)
    setDragOver(false)
  }

  const isProcessing = phase === 'uploading' || phase === 'polling'

  const currentStage: ProcessingStage =
    phase === 'uploading' ? 'QUEUED' :
    phase === 'polling' && pollState.phase === 'polling' ? pollState.stage :
    'QUEUED'

  return (
    <div className="min-h-screen bg-ink">
      {/* Nav — the "<- Back" button now triggers safeExit so the polling
          hook stops cleanly and the user is sent to the dashboard. It is
          responsive in every phase, including the error state. */}
      <nav className="border-b border-mist/50 px-6 py-4 flex items-center gap-4">
        <button
          type="button"
          onClick={safeExit}
          className="btn-ghost flex items-center gap-2 text-sm"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-azure flex items-center justify-center">
            <FileText className="w-3 h-3 text-white" />
          </div>
          <span className="font-display font-bold text-snow">InvoiceFlow AI</span>
        </div>
      </nav>
    

      <div className="max-w-xl mx-auto px-6 py-16">
        <h1 className="font-display text-4xl font-bold text-snow mb-2">Upload Invoice</h1>
        <p className="text-ghost mb-10">PDF or image. Our AI handles the rest.</p>

        {/* Terminal states */}
        {phase === 'done' && doneResult && (
          <SuccessCard result={doneResult} onUploadAnother={reset} />
        )}

        {phase === 'error' && errorMsg && !doneResult && (
          <ErrorCard message={errorMsg} onRetry={reset} />
        )}

        {/* Upload + polling flow */}
        {phase !== 'done' && (
          <>
            <DropZone
              file={file}
              dragOver={dragOver}
              disabled={isProcessing}
              onDrop={onDrop}
              onDragOver={() => setDragOver(true)}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
              onRemove={reset}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />

            {/* Processing timeline */}
            {isProcessing && (
              <ProcessingTimeline currentStage={currentStage} />
            )}

            {/* Error inline (validation errors, not terminal) */}
            {phase === 'error' && errorMsg && (
              <div className="mt-4 flex items-start gap-3 bg-rose/10 border border-rose/20 rounded-lg p-4">
                <AlertCircle className="w-5 h-5 text-rose flex-shrink-0 mt-0.5" />
                <p className="text-rose text-sm">{errorMsg}</p>
              </div>
            )}

            {/* Upload button (Process Invoice) */}
            {file && phase === 'idle' && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isProcessing}
                className="btn-primary w-full mt-6 py-3 text-base flex items-center justify-center gap-2"
              >
                <ZapIcon className="w-4 h-4" />
                Process Invoice
              </button>
            )}
          </>
        )}

        {/* Feature pills */}
        {(phase === 'idle' || phase === 'error') && (
          <div className="grid grid-cols-3 gap-4 mt-10">
            {[
              { label: 'Auto-extraction',  desc: 'Vendor, amounts, line items' },
              { label: 'PO matching',      desc: 'Auto + discrepancy flags' },
              { label: 'Audit trail',      desc: 'Every action in DynamoDB' },
            ].map(({ label, desc }) => (
              <div key={label} className="bg-slate rounded-lg p-3 text-center">
                <p className="text-xs font-semibold text-azure mb-1">{label}</p>
                <p className="text-xs text-ghost">{desc}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ZapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}
