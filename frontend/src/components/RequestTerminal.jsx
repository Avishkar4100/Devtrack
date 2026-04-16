import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import api from '@/lib/api'
import { connectSocket } from '@/lib/socket'
import { useManualBridgeStore } from '@/store/manualBridgeStore'

const normalizeRows = (value) => (Array.isArray(value) ? value : [])

const parseJsonSafe = (text) => {
  if (!text || !text.trim()) return { valid: false, parsed: null, error: '' }
  try {
    return { valid: true, parsed: JSON.parse(text), error: '' }
  } catch (error) {
    return { valid: false, parsed: null, error: error?.message || 'Invalid JSON' }
  }
}

const buildPreviewTable = (parsed) => {
  if (!parsed) return { columns: [], rows: [] }

  if (Array.isArray(parsed)) {
    const rows = parsed.filter((item) => item && typeof item === 'object')
    if (!rows.length) return { columns: [], rows: [] }
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
    return { columns, rows }
  }

  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.issues)) {
      const rows = parsed.issues.filter((item) => item && typeof item === 'object')
      const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
      return { columns, rows }
    }

    const rows = Object.entries(parsed).map(([key, value]) => ({ key, value: typeof value === 'object' ? JSON.stringify(value) : String(value) }))
    return { columns: ['key', 'value'], rows }
  }

  return { columns: [], rows: [] }
}

export default function RequestTerminal({ projectId }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [pendingRequests, setPendingRequests] = useState([])
  const [selectedRequestId, setSelectedRequestId] = useState('')
  const [responseText, setResponseText] = useState('')
  const responsesRef = useRef({})
  const syncBurstTimerRef = useRef(null)
  const setPendingRequestsStore = useManualBridgeStore((state) => state.setPendingRequests)
  const clearPendingRequestsStore = useManualBridgeStore((state) => state.clearPendingRequests)

  const selectedRequest = useMemo(
    () => pendingRequests.find((item) => item.id === selectedRequestId) || pendingRequests[0] || null,
    [pendingRequests, selectedRequestId]
  )

  const jsonState = useMemo(() => parseJsonSafe(responseText), [responseText])
  const preview = useMemo(() => buildPreviewTable(jsonState.parsed), [jsonState.parsed])

  const loadPending = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const { data } = await api.get('/manual-bridge/requests', {
        params: { status: 'pending', limit: 200 },
      })
      const rows = normalizeRows(data?.data)
      setPendingRequests(rows)
      setPendingRequestsStore(rows)

      if (rows.length > 0) {
        setOpen(true)
      }

      if (!rows.length) {
        setSelectedRequestId('')
        setResponseText('')
        clearPendingRequestsStore()
        return 0
      }

      const nextSelected = rows.find((item) => item.id === selectedRequestId) ? selectedRequestId : rows[0].id
      setSelectedRequestId(nextSelected)
      const cached = responsesRef.current[nextSelected]
      if (typeof cached === 'string') {
        setResponseText(cached)
      } else if (rows[0]?.responseText) {
        setResponseText(String(rows[0].responseText))
      }
      return rows.length
    } catch (error) {
      if (!silent) toast.error(error?.response?.data?.message || 'Failed to load pending LLM requests')
      return 0
    } finally {
      if (!silent) setLoading(false)
    }
  }, [clearPendingRequestsStore, selectedRequestId, setPendingRequestsStore])

  const runTriggeredSyncBurst = useCallback(() => {
    if (syncBurstTimerRef.current) {
      window.clearInterval(syncBurstTimerRef.current)
      syncBurstTimerRef.current = null
    }

    let attempts = 0
    syncBurstTimerRef.current = window.setInterval(async () => {
      attempts += 1
      const count = await loadPending(true)
      if (count > 0 || attempts >= 12) {
        window.clearInterval(syncBurstTimerRef.current)
        syncBurstTimerRef.current = null
      }
    }, 1000)
  }, [loadPending])

  useEffect(() => {
    loadPending(true)
  }, [loadPending])

  useEffect(() => {
    const socket = connectSocket(projectId)

    const syncPending = () => {
      socket.emit('manual-bridge:sync')
    }

    const onPendingCall = (payload) => {
      const pendingCount = Number(payload?.pendingCount || 0)
      if (pendingCount > 0) setOpen(true)
      loadPending(true)
    }

    const onResponseReceived = () => {
      loadPending(true)
    }

    socket.on('connect', syncPending)
    socket.on('PENDING_LLM_CALL', onPendingCall)
    socket.on('LLM_RESPONSE_RECEIVED', onResponseReceived)
    syncPending()

    return () => {
      socket.off('connect', syncPending)
      socket.off('PENDING_LLM_CALL', onPendingCall)
      socket.off('LLM_RESPONSE_RECEIVED', onResponseReceived)
    }
  }, [loadPending, projectId])

  useEffect(() => {
    const onManualBridgeRefresh = () => {
      runTriggeredSyncBurst()
    }

    window.addEventListener('manual-bridge:refresh', onManualBridgeRefresh)
    return () => {
      window.removeEventListener('manual-bridge:refresh', onManualBridgeRefresh)
      if (syncBurstTimerRef.current) {
        window.clearInterval(syncBurstTimerRef.current)
        syncBurstTimerRef.current = null
      }
    }
  }, [runTriggeredSyncBurst])

  useEffect(() => {
    if (!selectedRequest) return
    const currentText = responsesRef.current[selectedRequest.id]
    if (typeof currentText === 'string') {
      setResponseText(currentText)
    } else {
      setResponseText('')
    }
  }, [selectedRequest?.id])

  const handleCopyPrompt = async () => {
    const prompt = selectedRequest?.prompt || ''
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
      toast.success('Prompt copied')
    } catch (_) {
      toast.error('Copy failed')
    }
  }

  const handleResolve = async () => {
    if (!selectedRequest?.id) return
    const text = String(responseText || '').trim()
    if (!text) {
      toast.error('Paste response first')
      return
    }

    try {
      await api.post(`/manual-bridge/requests/${selectedRequest.id}/resolve`, {
        responseText: text,
      })
      toast.success('Response submitted')
      responsesRef.current[selectedRequest.id] = ''
      setResponseText('')
      loadPending(true)
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Failed to submit response')
    }
  }

  const handleReject = async () => {
    if (!selectedRequest?.id) return
    try {
      await api.post(`/manual-bridge/requests/${selectedRequest.id}/reject`, {
        error: 'Rejected from RequestTerminal',
      })
      toast.success('Request rejected')
      responsesRef.current[selectedRequest.id] = ''
      setResponseText('')
      loadPending(true)
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Failed to reject request')
    }
  }

  const onResponseChange = (value) => {
    setResponseText(value)
    if (selectedRequest?.id) {
      responsesRef.current[selectedRequest.id] = value
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          position: 'fixed',
          right: '20px',
          bottom: '24px',
          zIndex: 90,
          borderRadius: '999px',
          border: '1px solid var(--border-card)',
          background: 'var(--bg-card)',
          color: 'var(--text-primary)',
          padding: '10px 14px',
          fontSize: '12px',
          fontWeight: 700,
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        }}
      >
        Request Terminal ({pendingRequests.length})
      </button>

      {open && (
        <div
          style={{
            position: 'fixed',
            top: '52px',
            right: 0,
            width: 'min(720px, 94vw)',
            height: 'calc(100vh - 52px)',
            zIndex: 85,
            background: 'var(--bg-page)',
            borderLeft: '1px solid var(--border-card)',
            boxShadow: '-8px 0 24px rgba(0,0,0,0.2)',
            display: 'grid',
            gridTemplateRows: 'auto 1fr',
          }}
        >
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-card)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>Jugaad Logical LLM Terminal</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{pendingRequests.length} pending manual call(s)</div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn-secondary" onClick={() => loadPending(false)} disabled={loading}>Refresh</button>
              <button className="btn-secondary" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', minHeight: 0 }}>
            <div style={{ borderRight: '1px solid var(--border-card)', overflowY: 'auto' }}>
              {pendingRequests.map((req) => (
                <button
                  key={req.id}
                  type="button"
                  onClick={() => setSelectedRequestId(req.id)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    border: 'none',
                    borderBottom: '1px solid var(--border-card)',
                    background: selectedRequestId === req.id ? 'rgba(99,102,241,0.12)' : 'transparent',
                    color: 'var(--text-primary)',
                    padding: '10px',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 700 }}>{req.operation || 'llm_call'}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>{String(req.id || '').slice(0, 12)}</div>
                </button>
              ))}
              {!pendingRequests.length && (
                <div style={{ padding: '14px', fontSize: '12px', color: 'var(--text-muted)' }}>No pending requests.</div>
              )}
            </div>

            <div style={{ padding: '12px', overflowY: 'auto' }}>
              {!selectedRequest && <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Select a request from the list.</div>}

              {selectedRequest && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Request ID: {selectedRequest.id}</div>
                    <button className="btn-secondary" onClick={handleCopyPrompt}>Copy Prompt</button>
                  </div>

                  <textarea
                    readOnly
                    value={selectedRequest.prompt || ''}
                    style={{
                      width: '100%',
                      minHeight: '180px',
                      borderRadius: '10px',
                      border: '1px solid var(--border-input)',
                      background: 'var(--bg-input)',
                      color: 'var(--text-primary)',
                      padding: '10px',
                      fontSize: '12px',
                    }}
                  />

                  <div style={{ marginTop: '12px', marginBottom: '6px', fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>Paste LLM Response</div>
                  <textarea
                    value={responseText}
                    onChange={(e) => onResponseChange(e.target.value)}
                    placeholder="Paste Gemini/OpenRouter response..."
                    style={{
                      width: '100%',
                      minHeight: '180px',
                      borderRadius: '10px',
                      border: '1px solid var(--border-input)',
                      background: 'var(--bg-input)',
                      color: 'var(--text-primary)',
                      padding: '10px',
                      fontSize: '12px',
                    }}
                  />

                  <div style={{ marginTop: '8px', fontSize: '12px', color: jsonState.valid ? '#34d399' : 'var(--text-muted)' }}>
                    {jsonState.valid ? 'Valid JSON detected' : (jsonState.error ? `JSON check: ${jsonState.error}` : 'JSON check: waiting for input')}
                  </div>

                  {preview.columns.length > 0 && (
                    <div style={{ marginTop: '10px', border: '1px solid var(--border-card)', borderRadius: '10px', overflow: 'auto', maxHeight: '220px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-card)' }}>
                            {preview.columns.map((col) => (
                              <th key={col} style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid var(--border-card)', color: 'var(--text-secondary)' }}>{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.rows.slice(0, 20).map((row, idx) => (
                            <tr key={idx}>
                              {preview.columns.map((col) => (
                                <td key={`${idx}-${col}`} style={{ padding: '8px', borderBottom: '1px solid var(--border-card)', color: 'var(--text-primary)' }}>
                                  {row?.[col] === undefined || row?.[col] === null
                                    ? ''
                                    : (typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col]))}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                    <button className="btn-primary" onClick={handleResolve}>Submit Response</button>
                    <button className="btn-secondary" onClick={handleReject}>Reject</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
