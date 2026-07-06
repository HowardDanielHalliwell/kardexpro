import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

export default function Home() {
  const { user, profile } = useAuth()
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    supabase
      .from('groups')
      .select('*')
      .eq('teacher_id', user.id)
      .order('school_year', { ascending: false })
      .order('name')
      .limit(4)
      .then(({ data }) => {
        setGroups(data ?? [])
        setLoading(false)
      })
  }, [user])

  const name = profile?.full_name?.split(' ')[0] || 'docente'

  return (
    <>
      <h1 className="page-title">
        {greeting()}, {name} 👋
      </h1>

      <div className="quick-grid">
        <Link to="/registro">
          <span className="icon" aria-hidden="true">📋</span>
          Pasar registro
        </Link>
        <Link to="/materias">
          <span className="icon" aria-hidden="true">📚</span>
          Configurar materias
        </Link>
      </div>

      <div className="card">
        <h2>Tus grupos recientes</h2>
        {loading ? (
          <div className="center"><span className="spinner" /></div>
        ) : groups.length === 0 ? (
          <div className="empty-state">
            <span className="icon" aria-hidden="true">👥</span>
            Aún no tienes grupos.
            <div style={{ marginTop: 12 }}>
              <Link className="btn btn-orange" to="/grupos">Crear mi primer grupo</Link>
            </div>
          </div>
        ) : (
          <>
            {groups.map((g) => (
              <Link key={g.id} to={`/grupos/${g.id}`} className="group-card" style={{ boxShadow: 'none', border: '1.5px solid var(--border)' }}>
                <span className="badge">{g.grade || g.name?.[0] || 'G'}</span>
                <span className="info">
                  <b>{g.name}</b>
                  <span className="muted">Ciclo {g.school_year}</span>
                </span>
                <span className="arrow" aria-hidden="true">›</span>
              </Link>
            ))}
            <Link to="/grupos" className="muted" style={{ display: 'block', textAlign: 'center', padding: 8, fontWeight: 700 }}>
              Ver todos los grupos →
            </Link>
          </>
        )}
      </div>
    </>
  )
}
