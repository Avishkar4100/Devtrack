import { useCallback, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useDropzone } from 'react-dropzone'
import {
  DocumentArrowUpIcon, DocumentTextIcon, ArrowPathIcon,
  CheckCircleIcon, ExclamationCircleIcon, ClockIcon, XCircleIcon,
} from '@heroicons/react/24/outline'
import api from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import toast from 'react-hot-toast'
import { useEffect } from 'react'
import { connectSocket, disconnectSocket } from '@/lib/socket'

const StatusIcon = ({ status }) => {
  switch (status) {
    case 'processed': return <CheckCircleIcon className="w-5 h-5 text-emerald-600" />
    case 'processing': return <ArrowPathIcon className="w-5 h-5 text-blue-600 animate-spin" />
    case 'failed': return <XCircleIcon className="w-5 h-5 text-red-500" />
    default: return <ClockIcon className="w-5 h-5 text-gray-400" />
  }
}

const statusColors = {
  uploaded: 'bg-gray-100 text-gray-500',
  processing: 'bg-blue-50 text-blue-600 border border-blue-200',
  processed: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  failed: 'bg-red-50 text-red-600 border border-red-200',
}

export default function DocumentsPage() {
  const { id: projectId } = useParams()
  const qc = useQueryClient()
  const [selectedStrategy, setSelectedStrategy] = useState('standard')
  const [historyModal, setHistoryModal] = useState({ open: false, docId: null })
  const [extractionHistory, setExtractionHistory] = useState([])

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['documents', projectId],
    queryFn: async () => {
      const { data } = await api.get(`/documents/project/${projectId}`)
      return data.data
    },
    refetchInterval: (query) => {
      const docs = query.state.data || []
      return docs.some((d) => d.status === 'processing') ? 3000 : false
    },
  })

  // Socket.io: listen for document:ingested and re-extraction events
  useEffect(() => {
    const socket = connectSocket(projectId)
    socket.on('document:ingested', () => {
      qc.invalidateQueries(['documents', projectId])
    })
    socket.on('document:re-extraction-start', (data) => {
      toast.loading('Re-extraction in progress...', { id: `re-ext-${data.docId}` })
      qc.invalidateQueries(['documents', projectId])
    })
    socket.on('document:re-extraction-complete', (data) => {
      toast.success(`Re-extraction completed with score: ${data.validationScore}/100`, { id: `re-ext-${data.docId}` })
      qc.invalidateQueries(['documents', projectId])
    })
    socket.on('document:re-extraction-failed', (data) => {
      toast.error(`Re-extraction failed: ${data.error}`, { id: `re-ext-${data.docId}` })
      qc.invalidateQueries(['documents', projectId])
    })
    return () => {
      socket.off('document:ingested')
      socket.off('document:re-extraction-start')
      socket.off('document:re-extraction-complete')
      socket.off('document:re-extraction-failed')
      disconnectSocket(projectId)
    }
  }, [projectId, qc])

  const uploadMutation = useMutation({
    mutationFn: async (files) => {
      const results = []
      for (const file of files) {
        const fd = new FormData()
        fd.append('document', file)
        const { data } = await api.post(`/documents/upload/${projectId}`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        results.push(data)
      }
      return results
    },
    onSuccess: () => {
      qc.invalidateQueries(['documents', projectId])
      toast.success('Document(s) uploaded and ingestion started!')
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Upload failed'),
  })

  const reingestMutation = useMutation({
    mutationFn: (docId) => api.post(`/documents/${docId}/reingest`),
    onSuccess: () => {
      qc.invalidateQueries(['documents', projectId])
      toast.success('Re-ingestion started')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (docId) => api.delete(`/documents/${docId}`),
    onSuccess: () => {
      qc.invalidateQueries(['documents', projectId])
      toast.success('Document deleted')
    },
  })

  const reExtractMutation = useMutation({
    mutationFn: ({ docId, strategy }) => api.post(`/documents/${docId}/re-extract`, { strategy }),
    onSuccess: () => {
      qc.invalidateQueries(['documents', projectId])
      toast.success('Re-extraction started')
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Re-extraction failed'),
  })

  const openExtractionHistory = async (docId) => {
    try {
      const { data } = await api.get(`/documents/${docId}/extraction-history?limit=20`)
      setExtractionHistory(data.data || [])
      setHistoryModal({ open: true, docId })
    } catch (err) {
      toast.error('Failed to load extraction history')
    }
  }

  const onDrop = useCallback(
    (acceptedFiles) => {
      if (acceptedFiles.length) uploadMutation.mutate(acceptedFiles)
    },
    [uploadMutation]
  )

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'text/plain': ['.txt'],
      'text/markdown': ['.md'],
      'text/x-markdown': ['.md'],
    },
    maxSize: 50 * 1024 * 1024,
    multiple: true,
  })

  const processing = documents.filter((d) => d.status === 'processing')
  const processed = documents.filter((d) => d.status === 'processed')
  const failed = documents.filter((d) => d.status === 'failed')

  return (
    <div className="p-6 max-w-5xl mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">SRS Documents</h1>
        <p className="text-gray-500 text-sm">
          {processed.length} processed · {documents.length} total
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total', value: documents.length, color: 'text-gray-700' },
          { label: 'Processed', value: processed.length, color: 'text-emerald-600' },
          { label: 'Processing', value: processing.length, color: 'text-blue-600' },
          { label: 'Failed', value: failed.length, color: 'text-red-500' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card p-4 text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-500 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all mb-6 ${
          isDragActive
            ? 'border-primary-400 bg-primary-50'
            : 'border-gray-200 bg-gray-50 hover:border-primary-300 hover:bg-primary-50/40'
        }`}
      >
        <input {...getInputProps()} />
        <DocumentArrowUpIcon className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        {uploadMutation.isPending ? (
          <p className="text-gray-500">
            <span className="animate-pulse">Uploading...</span>
          </p>
        ) : isDragActive ? (
          <p className="text-primary-600 font-medium">Drop files here</p>
        ) : (
          <>
            <p className="text-gray-700 font-medium">Drag & drop documents here</p>
            <p className="text-gray-400 text-sm mt-1">Supports PDF, DOCX, TXT, MD · Max 50 MB per file</p>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); open(); }}
              className="btn-primary btn-sm mt-4"
            >
              <DocumentArrowUpIcon className="w-4 h-4" />
              Choose Files to Upload
            </button>
          </>
        )}
      </div>

      {/* Document list */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="card h-20 animate-pulse" />)}
        </div>
      ) : documents.length === 0 ? (
        <div className="card p-16 text-center">
          <DocumentTextIcon className="w-14 h-14 text-gray-200 mx-auto mb-4" />
          <p className="text-gray-700 font-medium">No documents uploaded</p>
          <p className="text-gray-400 text-sm mt-1">Upload an SRS document to enable AI story generation</p>
        </div>
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => (
            <div key={doc._id} className="card p-4 flex items-center gap-4 group">
              <StatusIcon status={doc.status} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-gray-900 text-sm truncate">{doc.originalName}</p>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${statusColors[doc.status]}`}>
                    {doc.status}
                  </span>
                  {doc.extractedRequirements?.validationScore !== undefined && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                      Score: {doc.extractedRequirements.validationScore}/100
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                  <span className="text-xs text-gray-500">{doc.fileType?.toUpperCase()}</span>
                  {doc.ingestionStatus?.chunks > 0 && (
                    <span className="text-xs text-gray-500">{doc.ingestionStatus.chunks} chunks</span>
                  )}
                  {doc.ingestionStatus?.embeddings > 0 && (
                    <span className="text-xs text-gray-500">{doc.ingestionStatus.embeddings} embeddings</span>
                  )}
                  {doc.ingestionStatus?.processingTime > 0 && (
                    <span className="text-xs text-gray-500">{doc.ingestionStatus.processingTime.toFixed(1)}s</span>
                  )}
                  <span className="text-xs text-gray-600">{formatRelativeTime(doc.createdAt)}</span>
                </div>

                {doc.status === 'failed' && doc.ingestionStatus?.errorMessage && (
                  <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                    <ExclamationCircleIcon className="w-3.5 h-3.5" />
                    {doc.ingestionStatus.errorMessage}
                  </p>
                )}

                {doc.extractedRequirements?.validationWarnings && doc.extractedRequirements.validationWarnings.length > 0 && (
                  <div className="text-xs text-yellow-600 mt-1 flex items-start gap-1 bg-yellow-50 p-1.5 rounded">
                    <ExclamationCircleIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>{doc.extractedRequirements.validationWarnings.join(', ')}</span>
                  </div>
                )}

                {doc.status === 'processing' && (
                  <div className="w-full mt-2 progress-bar">
                    <div className="progress-fill animate-pulse" style={{ width: '60%', background:'linear-gradient(90deg, #3b82f6, #6366f1)' }} />
                  </div>
                )}
              </div>

              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                {(doc.status === 'failed' || doc.status === 'processed') && (
                  <>
                    <button
                      onClick={() => reingestMutation.mutate(doc._id)}
                      disabled={reingestMutation.isPending}
                      className="btn-secondary btn-sm"
                      title="Re-ingest"
                    >
                      <ArrowPathIcon className="w-4 h-4" />
                      <span className="hidden sm:inline">Re-ingest</span>
                    </button>
                    {doc.status === 'processed' && (
                      <div className="relative group/strategy">
                        <button
                          className="btn-secondary btn-sm"
                          title="Re-extract"
                        >
                          <ArrowPathIcon className="w-4 h-4" />
                          <span className="hidden sm:inline">Re-extract</span>
                          <span className="text-xs ml-1">▼</span>
                        </button>
                        <div className="absolute right-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10 hidden group-hover/strategy:block">
                          {['standard', 'detail_focused', 'module_first', 'actor_driven', 'constraint_heavy'].map((strategy) => (
                            <button
                              key={strategy}
                              onClick={() => reExtractMutation.mutate({ docId: doc._id, strategy })}
                              disabled={reExtractMutation.isPending}
                              className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
                            >
                              {strategy === 'standard' && '📋 Standard'}
                              {strategy === 'detail_focused' && '🔍 Detail Focused'}
                              {strategy === 'module_first' && '📦 Module First'}
                              {strategy === 'actor_driven' && '👤 Actor Driven'}
                              {strategy === 'constraint_heavy' && '⚖️ Constraint Heavy'}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {doc.extractedRequirements && (
                      <button
                        onClick={() => openExtractionHistory(doc._id)}
                        className="btn-secondary btn-sm"
                        title="View extraction history"
                      >
                        <DocumentTextIcon className="w-4 h-4" />
                        <span className="hidden sm:inline">History</span>
                      </button>
                    )}
                  </>
                )}
                <button
                  onClick={() => deleteMutation.mutate(doc._id)}
                  className="text-red-400 hover:text-red-300 btn-ghost btn-sm p-1"
                  title="Delete"
                >
                  <XCircleIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info box */}
      <div className="mt-6 p-4 rounded-xl bg-primary-50 border border-primary-200">
        <p className="text-sm text-primary-700 font-semibold mb-1">How it works</p>
        <ol className="text-xs text-gray-500 space-y-1 list-decimal list-inside">
          <li>Upload your SRS, requirements, or design document (PDF, DOCX, TXT or MD)</li>
          <li>DevTrack AI parses and embeds the document into a vector database</li>
          <li>Go to <strong className="text-gray-800">Stories</strong> and click <em>AI Generate</em> to create User Stories from the document</li>
        </ol>
      </div>

      {/* Extraction History Modal */}
      {historyModal.open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Extraction History</h3>
              <button
                onClick={() => setHistoryModal({ open: false, docId: null })}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            
            <div className="p-4 space-y-3">
              {extractionHistory.length === 0 ? (
                <p className="text-center text-gray-500 py-8">No extraction history available</p>
              ) : (
                extractionHistory.map((extraction, idx) => (
                  <div key={idx} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="font-semibold text-sm text-gray-900">Version {extraction.extractionVersion}</p>
                        <p className="text-xs text-gray-500">{extraction.lastStrategy?.replace(/_/g, ' ').toUpperCase()}</p>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-purple-600">{extraction.validationScore}/100</div>
                        <p className="text-xs text-gray-500">{new Date(extraction.createdAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                    
                    {extraction.validationWarnings && extraction.validationWarnings.length > 0 && (
                      <div className="mt-2 text-xs text-yellow-700 bg-yellow-50 p-2 rounded">
                        <span className="font-semibold">Warnings:</span> {extraction.validationWarnings.join(', ')}
                      </div>
                    )}
                    
                    <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
                      <div className="bg-white p-2 rounded">
                        <p className="text-gray-600">Functional</p>
                        <p className="font-semibold text-gray-900">{extraction.functional?.length || 0}</p>
                      </div>
                      <div className="bg-white p-2 rounded">
                        <p className="text-gray-600">Non-functional</p>
                        <p className="font-semibold text-gray-900">{extraction.nonFunctional?.length || 0}</p>
                      </div>
                      <div className="bg-white p-2 rounded">
                        <p className="text-gray-600">Modules</p>
                        <p className="font-semibold text-gray-900">{extraction.modules?.length || 0}</p>
                      </div>
                      <div className="bg-white p-2 rounded">
                        <p className="text-gray-600">Actors</p>
                        <p className="font-semibold text-gray-900">{extraction.actors?.length || 0}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
