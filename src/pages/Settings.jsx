import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Settings() {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <>
      <h1 className="page-title">Ajustes</h1>

      <div className="card">
        <h2>Tu cuenta</h2>
        <p style={{ fontWeight: 700 }}>{profile?.full_name || 'Docente'}</p>
        <p className="muted">{user?.email}</p>
      </div>

      <div className="card">
        <h2>Acerca de</h2>
        <p className="muted">
          KardexPro v1.0 — Suite Genius Cooper™
          <br />
          Colegio Mano Amiga Chalco
        </p>
        <p className="muted" style={{ marginTop: 8 }}>
          💡 Puedes instalar esta app en tu teléfono: en Chrome abre el menú ⋮ y elige{' '}
          <b>«Agregar a pantalla principal»</b>.
        </p>
      </div>

      <button className="btn btn-danger btn-block" onClick={handleSignOut}>
        Cerrar sesión
      </button>
    </>
  )
}
