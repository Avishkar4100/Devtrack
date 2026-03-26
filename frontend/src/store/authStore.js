import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isLoading: false,

      setAuth: (user, token) => set({ user, token }),

      updateUser: (updates) => set((state) => ({
        user: state.user ? { ...state.user, ...updates } : updates,
      })),

      logout: () => {
        set({ user: null, token: null })
        try {
          localStorage.removeItem('devtrack-project')
          localStorage.removeItem('devtrack-workspace-state')
          localStorage.removeItem('devtrack-notifications')
        } catch (_) {
          // no-op for restricted storage environments
        }
        window.location.href = '/login'
      },

      isManager: () => get().user?.role === 'manager',
      isScrumMaster: () => get().user?.role === 'scrum_master',
    }),
    {
      name: 'devtrack-auth',
      partialize: (state) => ({ user: state.user, token: state.token }),
    }
  )
)
