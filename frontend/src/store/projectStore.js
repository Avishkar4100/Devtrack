import { create } from 'zustand'

export const useProjectStore = create((set) => ({
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
}))
