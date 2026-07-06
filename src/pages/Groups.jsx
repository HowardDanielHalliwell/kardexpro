import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

function defaultSchoolYear() {
  const now = new Date()
  const start = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1
  return `${start}-${start + 1}`
}

export default function Groups() {
  const { user } = useAuth()
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [grade, setGrade] = useState('')
  const [schoolYear, setSchoolYear] = useState(defaultSchoolYear())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user) return
    supabase
      .from('groups')
      .select('*')
      .eq('teacher_id', user.id)
      .order('school_year', { ascending: false })
      .order('name')
      .then(({ data, error: err }) => {
        if (err) setError('No se pudieron cargar los grupos: ' + err.message)
        setGroups(data ?? [])
        setLoading(false)
      })
  }, [user])

  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('Escribe el nombre del grupo (ej. 3° A).')
      return
    }
    setSaving(true)
    const { data, error: err } = await supabase
      .from('groups')
      .insert({
        teacher_id: user.id,
        name: name.trim(),
        grade: grade.trim() || null,
        school_year: schoolYear.trim(),
      })
      .select()
      .single()
    setSaving(false)
    if (err) {
      setError('No se pudo crear el grupo: ' + err.message)
      return
    }
    setGroups((prev) => [data, ...prev])
    setName('')
    setGrade('')
    setShowForm(false)
  }

  return (
    <>
      <h1 className="page-title">Grupos</h1>

      {error && <div className="alert alert-error">{error}</div>}

      {!showForm && (
        <button className="btn btn-orange btn-block" style={{ marginBottom: 14 }} onClick={() => setShowForm(true)}>
          ＋ Nuevo grupo
        </button>
      )}

      {showForm && (
        <form className="card" onSubmit={handleCreate}>
          <h2>Nuevo grupo</h2>
          <div className="field">
            <label htmlFor="g-name">Nombre del grupo</label>
            <input
              id="g-name"
              className="input"
              placeholder="Ej. 3° A Secundaria"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="row">
            <div className="field grow">
              <label htmlFor="g-grade">Grado</label>
              <input
                id="g-grade"
                className="input"
                placeholder="Ej. 3°"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
              />
            </div>
            <div className="field grow">
              <label htmlFor="g-year">Ciclo escolar</label>
              <input
                id="g-year"
                className="input"
                placeholder="2025-2026"
                value={schoolYear}
                onChange={(e) => setSchoolYear(e.target.value)}
              />
            </div>
          </div>
          <div className="row">
            <button type="button" className="btn btn-ghost grow" onClick={() => setShowForm(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-orange grow" disabled={saving}>
              {saving ? 'Guardando…' : 'Crear grupo'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="center"><span className="spinner" /></div>
      ) : groups.length === 0 && !showForm ? (
        <div className="card empty-state">
          <span className="icon" aria-hidden="true">👥</span>
          Aún no tienes grupos. Crea el primero con el botón de arriba.
        </div>
      ) : (
        groups.map((g) => (
          <Link key={g.id} to={`/grupos/${g.id}`} className="group-card">
            <span className="badge">{g.grade || g.name?.[0] || 'G'}</span>
            <span className="info">
              <b>{g.name}</b>
              <span className="muted">Ciclo {g.school_year}</span>
            </span>
            <span className="arrow" aria-hidden="true">›</span>
          </Link>
        ))
      )}
    </>
  )
}
