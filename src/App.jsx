import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Home from './pages/Home'
import Groups from './pages/Groups'
import GroupDetail from './pages/GroupDetail'
import SubjectConfig from './pages/SubjectConfig'
import ClassRegister from './pages/ClassRegister'
import Settings from './pages/Settings'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Home />} />
        <Route path="/grupos" element={<Groups />} />
        <Route path="/grupos/:groupId" element={<GroupDetail />} />
        <Route path="/materias" element={<SubjectConfig />} />
        <Route path="/registro" element={<ClassRegister />} />
        <Route path="/ajustes" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
