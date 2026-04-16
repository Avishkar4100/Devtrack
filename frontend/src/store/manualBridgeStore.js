import { create } from 'zustand'

export const useManualBridgeStore = create((set) => ({
  pendingCount: 0,
  pendingRequests: [],
  updatedAt: null,

  setPendingRequests: (rows = []) => {
    const safeRows = Array.isArray(rows) ? rows : []
    set({
      pendingRequests: safeRows,
      pendingCount: safeRows.length,
      updatedAt: new Date().toISOString(),
    })
  },

  clearPendingRequests: () => {
    set({
      pendingRequests: [],
      pendingCount: 0,
      updatedAt: new Date().toISOString(),
    })
  },
}))
