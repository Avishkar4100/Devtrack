import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const EMPTY_AI_PLANNER = {
  chatInput: '',
  planningPrompt: '',
  selectedSuggestionChips: [],
  suggestionsOpen: false,
  suggestions: { epics: [], stories: [], tasks: [] },
  backlogDraft: { epics: [], stories: [], tasks: [], subtasks: [] },
  lastSrsLabel: '',
  plannerResetAt: null,
  plannerChat: [
    {
      role: 'assistant',
      text: 'Upload SRS, press Suggest, pick context prompts, add your instruction, then generate editable backlog and confirm push to Jira.',
    },
  ],
}

const EMPTY_PROJECT_WORKSPACE = {
  activeTab: 'overview',
  generatedBacklogDraft: { epics: [], stories: [], tasks: [], subtasks: [] },
}

const getProjectKey = (projectId) => projectId || '__fallback__'

export const useWorkspaceStateStore = create(
  persist(
    (set, get) => ({
      hydrated: false,
      aiPlannerByProject: {},
      projectWorkspaceByProject: {},

      setHydrated: (hydrated) => set({ hydrated }),

      getAIPlannerState: (projectId) => {
        const key = getProjectKey(projectId)
        return get().aiPlannerByProject[key] || EMPTY_AI_PLANNER
      },

      setAIPlannerState: (projectId, nextState) => {
        const key = getProjectKey(projectId)
        set((state) => ({
          aiPlannerByProject: {
            ...state.aiPlannerByProject,
            [key]: {
              ...EMPTY_AI_PLANNER,
              ...(state.aiPlannerByProject[key] || {}),
              ...(nextState || {}),
            },
          },
        }))
      },

      clearAIPlannerState: (projectId) => {
        const key = getProjectKey(projectId)
        set((state) => {
          const next = { ...state.aiPlannerByProject }
          delete next[key]
          return { aiPlannerByProject: next }
        })
      },

      getProjectWorkspaceState: (projectId) => {
        const key = getProjectKey(projectId)
        return get().projectWorkspaceByProject[key] || EMPTY_PROJECT_WORKSPACE
      },

      setProjectWorkspaceState: (projectId, nextState) => {
        const key = getProjectKey(projectId)
        set((state) => ({
          projectWorkspaceByProject: {
            ...state.projectWorkspaceByProject,
            [key]: {
              ...EMPTY_PROJECT_WORKSPACE,
              ...(state.projectWorkspaceByProject[key] || {}),
              ...(nextState || {}),
            },
          },
        }))
      },

      clearProjectWorkspaceState: (projectId) => {
        const key = getProjectKey(projectId)
        set((state) => {
          const next = { ...state.projectWorkspaceByProject }
          delete next[key]
          return { projectWorkspaceByProject: next }
        })
      },

      clearAllWorkspaceState: () => set({
        aiPlannerByProject: {},
        projectWorkspaceByProject: {},
      }),
    }),
    {
      name: 'devtrack-workspace-state',
      partialize: (state) => ({
        aiPlannerByProject: state.aiPlannerByProject,
        projectWorkspaceByProject: state.projectWorkspaceByProject,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.setHydrated) state.setHydrated(true)
      },
    }
  )
)
