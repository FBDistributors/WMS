import { Navigate } from 'react-router-dom'

export function AppFeedbackPage() {
  return <Navigate to="/admin/profile?tab=app_feedback" replace />
}
