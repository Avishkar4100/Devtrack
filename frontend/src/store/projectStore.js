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
      setProjects: (projects) => set({ projects }),
      setSelectedProjectId: (selectedProjectId) => set({ selectedProjectId }),
      setSelectedJiraProjectKey: (selectedJiraProjectKey) => set({ selectedJiraProjectKey }),
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
