import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { apiClassroom } from '../lib/api'

function formatSyncedAt(iso) {
  if (!iso) return 'nunca'
  try {
    return new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

// Sección "Google Classroom" de SubjectConfig. Tres estados:
// sin conexión → conectar; conectado sin vincular → elegir curso;
// vinculada → última sincronización + sincronizar ahora.
export default function ClassroomPanel({ subject, trimester, onSubjectUpdated, onSynced }) {
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [courses, setCourses] = useState([])
  const [selectedCourse, setSelectedCourse] = useState('')
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState(null) // {type: 'success'|'error', text}
  const [searchParams, setSearchParams] = useSearchParams()

  // Resultado del redirect de OAuth (?classroom=conectado|error)
  useEffect(() => {
    const flag = searchParams.get('classroom')
    if (!flag) return
    if (flag === 'conectado') {
      setMessage({ type: 'success', text: 'Cuenta de Google Classroom conectada ✓' })
    } else {
      setMessage({
        type: 'error',
        text: 'No se pudo conectar con Google: ' + (searchParams.get('motivo') || 'error desconocido'),
      })
    }
    const next = new URLSearchParams(searchParams)
    next.delete('classroom')
    next.delete('motivo')
    setSearchParams(next, { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiClassroom('courses')
      .then((data) => {
        if (cancelled) return
        setConnected(Boolean(data.connected))
        setCourses(data.courses ?? [])
        if (data.error) setMessage({ type: 'error', text: data.error })
      })
      .catch((err) => {
        if (!cancelled) setMessage({ type: 'error', text: err.message })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  if (!subject) return null

  async function connect() {
    setBusy(true)
    setMessage(null)
    try {
      const { url } = await apiClassroom('auth-url')
      window.location.href = url
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
      setBusy(false)
    }
  }

  async function linkCourse() {
    if (!selectedCourse) return
    setBusy(true)
    setMessage(null)
    const { data, error } = await supabase
      .from('subjects')
      .update({ google_classroom_id: selectedCourse })
      .eq('id', subject.id)
      .select()
      .single()
    setBusy(false)
    if (error) {
      setMessage({ type: 'error', text: 'No se pudo vincular el curso: ' + error.message })
      return
    }
    onSubjectUpdated(data)
    setMessage({ type: 'success', text: 'Curso vinculado. Ya puedes sincronizar.' })
  }

  async function unlinkCourse() {
    if (!window.confirm('¿Desvincular esta materia de su curso de Classroom? Las actividades ya importadas se conservan.')) return
    const { data, error } = await supabase
      .from('subjects')
      .update({ google_classroom_id: null })
      .eq('id', subject.id)
      .select()
      .single()
    if (error) {
      setMessage({ type: 'error', text: 'No se pudo desvincular: ' + error.message })
      return
    }
    onSubjectUpdated(data)
  }

  async function syncNow() {
    setSyncing(true)
    setMessage(null)
    try {
      const result = await apiClassroom('sync', { method: 'POST', body: { subjectId: subject.id, trimester } })
      let text =
        `Sincronización completada: ${result.actividadesCreadas} actividad(es) creada(s), ` +
        `${result.calificacionesActualizadas} calificación(es) actualizada(s).`
      if (result.alumnosSinCoincidencia?.length) {
        text += ` ⚠ ${result.alumnosSinCoincidencia.length} correo(s) de Classroom sin alumno correspondiente: ${result.alumnosSinCoincidencia.join(', ')}`
      }
      setMessage({ type: result.alumnosSinCoincidencia?.length ? 'info' : 'success', text })
      onSubjectUpdated({ ...subject, google_classroom_synced_at: new Date().toISOString() })
      onSynced()
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
    setSyncing(false)
  }

  const linkedCourse = courses.find((c) => c.id === subject.google_classroom_id)

  return (
    <div className="card">
      <h2>Google Classroom</h2>

      {message && (
        <div
          className={`alert ${message.type === 'success' ? 'alert-success' : message.type === 'info' ? 'alert-info' : 'alert-error'}`}
          onClick={() => setMessage(null)}
        >
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="center"><span className="spinner" /></div>
      ) : !connected ? (
        <>
          <p className="muted" style={{ marginBottom: 10 }}>
            Conecta tu cuenta de Google para traer las entregas de Classroom (solo lectura:
            Classroom nunca se modifica desde KardexPro).
          </p>
          <button className="btn btn-block" onClick={connect} disabled={busy}>
            {busy ? 'Abriendo Google…' : '🔗 Conectar con Google Classroom'}
          </button>
        </>
      ) : !subject.google_classroom_id ? (
        <>
          <div className="field">
            <label htmlFor="gc-course">Curso de Classroom para «{subject.name}»</label>
            <select
              id="gc-course"
              className="input"
              value={selectedCourse}
              onChange={(e) => setSelectedCourse(e.target.value)}
            >
              <option value="">— Elige un curso —</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.section ? ` · ${c.section}` : ''}
                </option>
              ))}
            </select>
          </div>
          {courses.length === 0 && (
            <p className="muted" style={{ marginBottom: 10 }}>
              No se encontraron cursos activos donde seas docente.
            </p>
          )}
          <button className="btn btn-orange btn-block" onClick={linkCourse} disabled={busy || !selectedCourse}>
            {busy ? 'Vinculando…' : 'Vincular curso'}
          </button>
        </>
      ) : (
        <>
          <p className="muted">
            Curso vinculado: <b>{linkedCourse ? linkedCourse.name : subject.google_classroom_id}</b>
            <br />
            Última sincronización: <b>{formatSyncedAt(subject.google_classroom_synced_at)}</b>
          </p>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn btn-ghost btn-sm" onClick={unlinkCourse} disabled={syncing}>
              Desvincular
            </button>
            <button className="btn btn-orange grow" onClick={syncNow} disabled={syncing}>
              {syncing ? 'Sincronizando…' : `⟳ Sincronizar ahora (${trimester}° trim)`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
