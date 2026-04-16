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
import BacklogEditorPage from '@/pages/BacklogEditor'
import SettingsPage from '@/pages/Settings'
import InsightsPage from '@/pages/Insights'
import AIPlannerPage from '@/pages/AIPlanner'
import WorkspacePage from '@/pages/Workspace'
import AdminLayout from '@/components/AdminLayout'
import AdminLoginPage from '@/pages/AdminLogin'
import AdminOverviewPage from '@/pages/AdminOverview'
import AdminAIConfigPage from '@/pages/AdminAIConfig'

const getHomeByRole = (user) => (user?.role === 'admin' ? '/admin/overview' : '/overview')

const UserRoute = ({ children }) => {
  const { token, user } = useAuthStore()
  if (!token) return <Navigate to="/login" replace />
  if (user?.role === 'admin') return <Navigate to="/admin/overview" replace />
  return children
}

const AdminRoute = ({ children }) => {
  const { token, user } = useAuthStore()
  if (!token) return <Navigate to="/admin/login" replace />
  if (user?.role !== 'admin') return <Navigate to="/overview" replace />
  return children
}

const PublicRoute = ({ children }) => {
  const { token, user } = useAuthStore()
  if (!token) return children
  return <Navigate to={getHomeByRole(user)} replace />
}

const AdminPublicRoute = ({ children }) => {
  const { token, user } = useAuthStore()
  if (token && user?.role === 'admin') return <Navigate to="/admin/overview" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      {/* Public landing page */}
      <Route path="/" element={<PublicRoute><HomePage /></PublicRoute>} />
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
      <Route path="/admin/login" element={<AdminPublicRoute><AdminLoginPage /></AdminPublicRoute>} />

      {/* Password reset — public, no auth needed */}
      <Route path="/reset-password/:token" element={<ResetPasswordPage />} />

      {/* Email verification — public */}
      <Route path="/verify-email" element={<VerifyEmailPage />} />

      {/* OAuth callback — handles token from backend redirect */}
      <Route path="/auth/callback" element={<AuthCallbackPage />} />

      {/* User application (non-admin roles only) */}
      <Route path="/" element={<UserRoute><Layout /></UserRoute>}>
        <Route path="overview" element={<OverviewPage />} />
        <Route path="ai-planner" element={<AIPlannerPage />} />
        <Route path="workspace" element={<WorkspacePage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectWorkspacePage />} />
        <Route path="projects/:id/backlog-editor" element={<BacklogEditorPage />} />
        <Route path="insights" element={<InsightsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="dashboard" element={<Navigate to="/overview" replace />} />
      </Route>

      <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
        <Route index element={<Navigate to="/admin/overview" replace />} />
        <Route path="overview" element={<AdminOverviewPage />} />
        <Route path="ai-config" element={<AdminAIConfigPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
