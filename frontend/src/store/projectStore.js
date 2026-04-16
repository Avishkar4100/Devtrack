import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useProjectStore = create(
  persist(
    (set) => ({
      currentProject: null,
      projects: [],
      selectedProjectId: '',
      selectedJiraProjectKey: '',
      setCurrentProject: (project) => set({ currentProject: project }),
      setProjects: (projects = []) =>
        set((state) => {
          const current = Array.isArray(state.projects) ? state.projects : []
          const next = Array.isArray(projects) ? projects : []
          const sameLength = current.length === next.length
          const sameIds =
            sameLength &&
            current.every((p, idx) => {
              const currId = p?._id || ''
              const nextId = next[idx]?._id || ''
              return currId === nextId
            })
          if (sameIds) return state
          return { projects: next }
        }),
      setSelectedProjectId: (selectedProjectId) =>
        set((state) =>
          state.selectedProjectId === selectedProjectId
            ? state
            : { selectedProjectId }
        ),
      setSelectedJiraProjectKey: (selectedJiraProjectKey) =>
        set((state) =>
          state.selectedJiraProjectKey === selectedJiraProjectKey
            ? state
            : { selectedJiraProjectKey }
        ),
      updateProject: (updated) =>
        set((state) => ({
          projects: state.projects.map((p) => (p._id === updated._id ? updated : p)),
          currentProject: state.currentProject?._id === updated._id ? updated : state.currentProject,
        })),
      resetProjectState: () => set({
        currentProject: null,
        projects: [],
        selectedProjectId: '',
        selectedJiraProjectKey: '',
      }),
    }),
    {
      name: 'devtrack-project',
      partialize: (state) => ({
        currentProject: state.currentProject,
        projects: state.projects,
        selectedProjectId: state.selectedProjectId,
        selectedJiraProjectKey: state.selectedJiraProjectKey,
      }),
    }
  )
)
