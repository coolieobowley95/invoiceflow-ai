/**
 * useJobPolling
 *
 * Production-grade polling hook for async invoice processing jobs.
 *
 * Features:
 *  - Exponential backoff (1 s → 2 s → 4 s → capped at 8 s)
 *  - Automatic stop on terminal state or max-attempts exceeded
 *  - Jitter on each interval to avoid thundering-herd if many tabs open
 *  - Cleanup on unmount (no state updates to dead components)
 *  - Typed return value matching /api/status/[jobId] response
 */
import { useState, useEffect, useRef, useCallback } from 'react'

export type ProcessingStage =
  | 'QUEUED'
  | 'EXTRACTING_TEXT'
  | 'PARSING_FIELDS'
  | 'MATCHING_PO'
  | 'COMPLETE'
  | 'FAILED'

export type InvoiceStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'MATCHED'
  | 'DISCREPANCY'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAID'

export interface JobStatusResponse {
  jobId:          string
  status:         InvoiceStatus
  stage:          ProcessingStage
  isTerminal:     boolean
  invoiceNumber?: string
  vendorName?:    string
  totalAmount?:   number
  currency?:      string
  aiConfidence?:  number
  matchedPOId?:   string
  error?:         string
}

export type PollState =
  | { phase: 'idle' }
  | { phase: 'polling'; stage: ProcessingStage; attempts: number }
  | { phase: 'done';    result: JobStatusResponse }
  | { phase: 'error';   message: string }

interface UseJobPollingOptions {
  /** Poll interval base in ms. Doubles each round, capped at maxInterval. */
  baseInterval?:  number
  maxInterval?:   number
  /** Stop automatically after this many attempts (default 60 ≈ ~4 min). */
  maxAttempts?:   number
  onComplete?:    (result: JobStatusResponse) => void
  onError?:       (message: string) => void
}

export function useJobPolling(
  jobId: string | null,
  options: UseJobPollingOptions = {}
) {
  const {
    baseInterval  = 1500,
    maxInterval   = 8000,
    maxAttempts   = 60,
    onComplete,
    onError,
  } = options

  const [state, setState] = useState<PollState>({ phase: 'idle' })
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const attemptsRef = useRef(0)

  const stopPolling = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const poll = useCallback(async (id: string) => {
    if (!mountedRef.current) return

    attemptsRef.current += 1
    const attempt = attemptsRef.current

    try {
      const res  = await fetch(`/api/status/${id}`)
      const data: JobStatusResponse = await res.json()

      if (!mountedRef.current) return

      if (!res.ok) {
        throw new Error(data.error ?? `Status check failed (${res.status})`)
      }

      setState({ phase: 'polling', stage: data.stage, attempts: attempt })

      if (data.isTerminal) {
        stopPolling()
        setState({ phase: 'done', result: data })
        onComplete?.(data)
        return
      }

      if (attempt >= maxAttempts) {
        stopPolling()
        const msg = 'Processing is taking longer than expected. Check the dashboard.'
        setState({ phase: 'error', message: msg })
        onError?.(msg)
        return
      }

      // Schedule next poll with exponential backoff + jitter
      const base    = Math.min(baseInterval * 2 ** (attempt - 1), maxInterval)
      const jitter  = Math.random() * 400 - 200 // ±200 ms
      const delay   = Math.max(500, base + jitter)

      timerRef.current = setTimeout(() => poll(id), delay)
    } catch (err: any) {
      if (!mountedRef.current) return
      stopPolling()
      const msg = err.message || 'Network error during status check.'
      setState({ phase: 'error', message: msg })
      onError?.(msg)
    }
  }, [baseInterval, maxInterval, maxAttempts, onComplete, onError, stopPolling])

  // Start polling whenever jobId changes
  useEffect(() => {
    if (!jobId) {
      setState({ phase: 'idle' })
      return
    }

    attemptsRef.current = 0
    setState({ phase: 'polling', stage: 'QUEUED', attempts: 0 })
    poll(jobId)

    return () => {
      stopPolling()
    }
  }, [jobId, poll, stopPolling])

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopPolling()
    }
  }, [stopPolling])

  return state
}