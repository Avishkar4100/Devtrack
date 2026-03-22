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
<<<<<<< HEAD
import AdminLayout from '@/components/AdminLayout'
import AdminLoginPage from '@/pages/AdminLogin'
=======
import AdminLoginPage from '@/pages/AdminLogin'
import AdminLayout from '@/components/AdminLayout'
>>>>>>> f4f257f6624fcf48a6840ebc197cc11983daa266
import AdminOverviewPage from '@/pages/AdminOverview'
import AdminAIConfigPage from '@/pages/AdminAIConfig'
import AdminOrganizationsPage from '@/pages/AdminOrganizations'
import AdminProjectsPage from '@/pages/AdminProjects'
<<<<<<< HEAD

const getHomeByRole = (user) => (user?.role === 'admin' ? '/admin/overview' : '/overview')
=======
>>>>>>> f4f257f6624fcf48a6840ebc197cc11983daa266

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

const AdminRoute = ({ children }) => {
  const { token, user } = useAuthStore()
  if (!token) return <Navigate to="/admin/login" replace />
  if (user?.role !== 'admin') return <Navigate to="/overview" replace />
  return children
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
<<<<<<< HEAD
      <Route path="/admin/login" element={<PublicRoute><AdminLoginPage /></PublicRoute>} />
=======
      <Route path="/admin/login" element={<AdminPublicRoute><AdminLoginPage /></AdminPublicRoute>} />
>>>>>>> f4f257f6624fcf48a6840ebc197cc11983daa266

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

      <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
<<<<<<< HEAD
        <Route index element={<Navigate to="/admin/overview" replace />} />
=======
>>>>>>> f4f257f6624fcf48a6840ebc197cc11983daa266
        <Route path="overview" element={<AdminOverviewPage />} />
        <Route path="ai-config" element={<AdminAIConfigPage />} />
        <Route path="organizations" element={<AdminOrganizationsPage />} />
        <Route path="projects" element={<AdminProjectsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
