import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import Layout from '@/components/Layout'
import HomePage from '@/pages/Home'
import LoginPage from '@/pages/Login'
import RegisterPage from '@/pages/Register'
import ResetPasswordPage from '@/pages/ResetPassword'
import AuthCallbackPage from '@/pages/AuthCallback'
import VerifyEmailPage from '@/pages/VerifyEmail'
import OverviewPage from '@/pages/Overview'
import ProjectsPage from '@/pages/Projects'
import ProjectWorkspacePage from '@/pages/ProjectWorkspace'
import SettingsPage from '@/pages/Settings'
import InsightsPage from '@/pages/Insights'
import WorkspacePage from '@/pages/Workspace'
import AIPlannerPage from '@/pages/AIPlanner'

const UserRoute = ({ children }) => {
  const { token } = useAuthStore()
  if (!token) return <Navigate to="/login" replace />
  return children
}

const PublicRoute = ({ children }) => {
  const { token } = useAuthStore()
  if (!token) return children
  return <Navigate to="/overview" replace />
}

export default function App() {
  return (
    <Routes>
      {/* Public landing page */}
      <Route path="/" element={<PublicRoute><HomePage /></PublicRoute>} />
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />

      {/* Password reset — public, no auth needed */}
      <Route path="/reset-password/:token" element={<ResetPasswordPage />} />

      {/* Email verification — public */}
      <Route path="/verify-email" element={<VerifyEmailPage />} />

      {/* OAuth callback — handles token from backend redirect */}
      <Route path="/auth/callback" element={<AuthCallbackPage />} />

      {/* User application (non-admin roles only) */}
      <Route path="/" element={<UserRoute><Layout /></UserRoute>}>
        <Route path="overview" element={<OverviewPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectWorkspacePage />} />
        <Route path="ai-planner" element={<AIPlannerPage />} />
        <Route path="workspace" element={<WorkspacePage />} />
        <Route path="progress" element={<Navigate to="/insights" replace />} />
        <Route path="insights" element={<InsightsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="dashboard" element={<Navigate to="/overview" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
