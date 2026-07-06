import { useEffect, useState } from 'react'
import { supabase, TRIMESTERS, COMPONENT_KINDS } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import ClassroomPanel from '../components/ClassroomPanel'

const SUBJECT_COLORS = ['#1A2D6B', '#F47920', '#0E7490', '#7C3AED', '#16A34A', '#DC2626', '#D97706', '#DB2777']

const kindLabel = (value) => COMPONENT_KINDS.find((k) => k.value === value)?.label ?? value

export default function SubjectConfig() {
  const { user } = useAuth()
  const [groups, setGroups] = useState([])
  const [groupId, setGroupId] = useState('')
  const [subjects, setSubjects] = useState([])
  const [subjectId, setSubjectId] = useState('')
  const [trimester, setTrimester] = useState(1)
  const [components, setComponents] = useState([])
  const [loadingComponents, setLoadingComponents] = useState(false)
  const [error, setError] = useState('')

  // Alta de materia
  const [showSubjectForm, setShowSubjectForm] = useState(false)
  const [subjectName, setSubjectName] = useState('')
  const [subjectCode, setSubjectCode] = useState('')
  const [subjectColor, setSubjectColor] = useState(SUBJECT_COLORS[0])

  // Formulario de componente (nuevo o edición)
  const [componentForm, setComponentForm] = useState(null) // {id?, name, kind, percentage}

  // Actividades
  const [expandedId, setExpandedId] = useState(null)
  const [activities, setActivities] = useState({}) // componentId -> []
  const [activityForm, setActivityForm] = useState(null) // {componentId, name, max_score, due_date}

  // Se incrementa tras sincronizar con Classroom para recargar componentes/actividades
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!user) return
    supabase
      .from('groups')
      .select('*')
      .eq('teacher_id', user.id)
      .order('school_year', { ascending: false })
      .order('name')
      .then(({ data }) => {
        setGroups(data ?? [])
        if (data?.length === 1) setGroupId(data[0].id)
      })
  }, [user])

  useEffect(() => {
    setSubjects([])
    setSubjectId('')
    if (!groupId) return
    supabase
      .from('subjects')
      .select('*')
      .eq('group_id', groupId)
      .order('name')
      .then(({ data }) => {
        setSubjects(data ?? [])
        if (data?.length === 1) setSubjectId(data[0].id)
      })
  }, [groupId])

  useEffect(() => {
    setComponents([])
    setExpandedId(null)
    setComponentForm(null)
    setActivities({})
    if (!subjectId) return
    setLoadingComponents(true)
    supabase
      .from('evaluation_components')
      .select('*')
      .eq('subject_id', subjectId)
      .eq('trimester', trimester)
      .order('sort_order')
      .then(({ data, error: err }) => {
        if (err) setError('No se pudieron cargar los componentes: ' + err.message)
        setComponents(data ?? [])
        setLoadingComponents(false)
      })
  }, [subjectId, trimester, refreshKey])

  const total = components.reduce((sum, c) => sum + Number(c.percentage ?? 0), 0)
  const totalOk = total === 100

  async function createSubject(e) {
    e.preventDefault()
    setError('')
    if (!subjectName.trim()) {
      setError('Escribe el nombre de la materia.')
      return
    }
    const { data, error: err } = await supabase
      .from('subjects')
      .insert({
        teacher_id: user.id,
        group_id: groupId,
        name: subjectName.trim(),
        short_code: subjectCode.trim() || subjectName.trim().slice(0, 3).toUpperCase(),
        color: subjectColor,
      })
      .select()
      .single()
    if (err) {
      setError('No se pudo crear la materia: ' + err.message)
      return
    }
    setSubjects((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setSubjectId(data.id)
    setSubjectName('')
    setSubjectCode('')
    setShowSubjectForm(false)
  }

  function startNewComponent() {
    setComponentForm({ name: '', kind: 'simple', percentage: '' })
  }

  async function saveComponent(e) {
    e.preventDefault()
    setError('')
    const pct = Number(componentForm.percentage)
    if (!componentForm.name.trim()) {
      setError('Escribe el nombre del componente.')
      return
    }
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      setError('El porcentaje debe ser un número entre 1 y 100.')
      return
    }
    // Validación en cliente: la suma por materia+trimestre no puede pasar de 100
    // (la DB también lo rechaza con un trigger, pero avisamos antes)
    const otherTotal = components
      .filter((c) => c.id !== componentForm.id)
      .reduce((sum, c) => sum + Number(c.percentage ?? 0), 0)
    if (otherTotal + pct > 100) {
      setError(
        `Con este componente el total sería ${otherTotal + pct}%. ` +
          `Solo quedan ${100 - otherTotal}% disponibles en este trimestre.`
      )
      return
    }

    if (componentForm.id) {
      const { data, error: err } = await supabase
        .from('evaluation_components')
        .update({ name: componentForm.name.trim(), kind: componentForm.kind, percentage: pct })
        .eq('id', componentForm.id)
        .select()
        .single()
      if (err) {
        setError('No se pudo guardar: ' + err.message)
        return
      }
      setComponents((prev) => prev.map((c) => (c.id === data.id ? data : c)))
    } else {
      const { data, error: err } = await supabase
        .from('evaluation_components')
        .insert({
          subject_id: subjectId,
          trimester,
          name: componentForm.name.trim(),
          kind: componentForm.kind,
          percentage: pct,
          sort_order: components.length,
        })
        .select()
        .single()
      if (err) {
        setError('No se pudo crear el componente: ' + err.message)
        return
      }
      setComponents((prev) => [...prev, data])
    }
    setComponentForm(null)
  }

  async function deleteComponent(component) {
    if (!window.confirm(`¿Eliminar «${component.name}» y sus actividades?`)) return
    const { error: err } = await supabase.from('evaluation_components').delete().eq('id', component.id)
    if (err) {
      setError('No se pudo eliminar: ' + err.message)
      return
    }
    setComponents((prev) => prev.filter((c) => c.id !== component.id))
  }

  async function toggleExpand(componentId) {
    const next = expandedId === componentId ? null : componentId
    setExpandedId(next)
    setActivityForm(null)
    if (next && !activities[next]) {
      const { data } = await supabase
        .from('activities')
        .select('*')
        .eq('component_id', next)
        .order('sort_order')
      setActivities((prev) => ({ ...prev, [next]: data ?? [] }))
    }
  }

  async function saveActivity(e) {
    e.preventDefault()
    setError('')
    const { componentId, name, max_score, due_date } = activityForm
    if (!name.trim()) {
      setError('Escribe el nombre de la actividad.')
      return
    }
    const max = Number(max_score)
    if (!Number.isFinite(max) || max <= 0) {
      setError('La puntuación máxima debe ser mayor que 0.')
      return
    }
    const list = activities[componentId] ?? []
    const { data, error: err } = await supabase
      .from('activities')
      .insert({
        component_id: componentId,
        name: name.trim(),
        max_score: max,
        due_date: due_date || null,
        sort_order: list.length,
      })
      .select()
      .single()
    if (err) {
      setError('No se pudo crear la actividad: ' + err.message)
      return
    }
    setActivities((prev) => ({ ...prev, [componentId]: [...list, data] }))
    setActivityForm({ componentId, name: '', max_score: max_score, due_date: '' })
  }

  async function deleteActivity(componentId, activity) {
    if (!window.confirm(`¿Eliminar la actividad «${activity.name}»?`)) return
    const { error: err } = await supabase.from('activities').delete().eq('id', activity.id)
    if (err) {
      setError('No se pudo eliminar la actividad: ' + err.message)
      return
    }
    setActivities((prev) => ({
      ...prev,
      [componentId]: (prev[componentId] ?? []).filter((a) => a.id !== activity.id),
    }))
  }

  return (
    <>
      <h1 className="page-title">Materias</h1>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <div className="field">
          <label htmlFor="sel-group">Grupo</label>
          <select id="sel-group" className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">— Elige un grupo —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name} · {g.school_year}</option>
            ))}
          </select>
        </div>

        {groupId && (
          <>
            <div className="field">
              <label htmlFor="sel-subject">Materia</label>
              <select id="sel-subject" className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                <option value="">— Elige una materia —</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {!showSubjectForm ? (
              <button className="btn btn-ghost btn-block btn-sm" onClick={() => setShowSubjectForm(true)}>
                ＋ Nueva materia en este grupo
              </button>
            ) : (
              <form onSubmit={createSubject}>
                <div className="field">
                  <label htmlFor="sub-name">Nombre de la materia</label>
                  <input
                    id="sub-name"
                    className="input"
                    placeholder="Ej. Matemáticas"
                    value={subjectName}
                    onChange={(e) => setSubjectName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="row">
                  <div className="field grow">
                    <label htmlFor="sub-code">Código corto</label>
                    <input
                      id="sub-code"
                      className="input"
                      placeholder="MAT"
                      maxLength={6}
                      value={subjectCode}
                      onChange={(e) => setSubjectCode(e.target.value.toUpperCase())}
                    />
                  </div>
                  <div className="field grow">
                    <label htmlFor="sub-color">Color</label>
                    <select
                      id="sub-color"
                      className="input"
                      value={subjectColor}
                      onChange={(e) => setSubjectColor(e.target.value)}
                      style={{ borderLeft: `10px solid ${subjectColor}` }}
                    >
                      {SUBJECT_COLORS.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="row">
                  <button type="button" className="btn btn-ghost grow" onClick={() => setShowSubjectForm(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn btn-orange grow">Crear materia</button>
                </div>
              </form>
            )}
          </>
        )}
      </div>

      {subjectId && (
        <>
          <div className="card">
            <h2>Trimestre</h2>
            <div className="segments">
              {TRIMESTERS.map((t) => (
                <button key={t} className={trimester === t ? 'active' : ''} onClick={() => setTrimester(t)}>
                  {t}°
                </button>
              ))}
            </div>
          </div>

          <ClassroomPanel
            subject={subjects.find((s) => s.id === subjectId)}
            trimester={trimester}
            onSubjectUpdated={(updated) =>
              setSubjects((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
            }
            onSynced={() => setRefreshKey((k) => k + 1)}
          />

          <div className="card">
            <h2>Componentes de evaluación · {trimester}° trimestre</h2>

            <div className={`pct-indicator ${totalOk ? 'pct-ok' : 'pct-bad'}`}>
              Total: {total}% / 100%
              {!totalOk && total < 100 && <span style={{ fontWeight: 600 }}> · faltan {100 - total}%</span>}
              <div className="pct-bar">
                <div style={{ width: `${Math.min(total, 100)}%` }} />
              </div>
            </div>

            {loadingComponents ? (
              <div className="center"><span className="spinner" /></div>
            ) : components.length === 0 && !componentForm ? (
              <div className="empty-state">
                <span className="icon" aria-hidden="true">🧮</span>
                Sin componentes en este trimestre. Ej.: Tareas 40%, Examen 40%, Integradora 20%.
              </div>
            ) : (
              components.map((c) => {
                const acts = activities[c.id]
                const expanded = expandedId === c.id
                return (
                  <div key={c.id} className="component-card">
                    <div
                      className="component-head"
                      onClick={() => toggleExpand(c.id)}
                      role="button"
                      aria-expanded={expanded}
                    >
                      <span style={{ fontWeight: 700 }}>{c.name}</span>
                      <span className="kind-tag">{kindLabel(c.kind)}</span>
                      <span className="pct-tag">{Number(c.percentage)}%</span>
                      <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                    </div>

                    {expanded && (
                      <div style={{ marginTop: 8 }}>
                        <div className="row" style={{ marginBottom: 8 }}>
                          <button
                            className="btn btn-ghost btn-sm grow"
                            onClick={() => setComponentForm({ id: c.id, name: c.name, kind: c.kind, percentage: String(Number(c.percentage)) })}
                          >
                            ✏️ Editar
                          </button>
                          <button className="btn btn-ghost btn-sm grow" style={{ color: 'var(--red)' }} onClick={() => deleteComponent(c)}>
                            🗑️ Eliminar
                          </button>
                        </div>

                        {(acts ?? []).map((a) => (
                          <div key={a.id} className="activity-row">
                            <span className="grow">
                              <b>{a.name}</b>
                              <span className="muted"> · máx {Number(a.max_score)}{a.due_date ? ` · entrega ${a.due_date}` : ''}</span>
                            </span>
                            <button
                              className="icon-btn"
                              aria-label={`Eliminar actividad ${a.name}`}
                              onClick={() => deleteActivity(c.id, a)}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        {acts && acts.length === 0 && <p className="muted">Sin actividades todavía.</p>}

                        {activityForm?.componentId === c.id ? (
                          <form onSubmit={saveActivity} style={{ marginTop: 8 }}>
                            <div className="field">
                              <input
                                className="input"
                                placeholder="Nombre de la actividad"
                                value={activityForm.name}
                                onChange={(e) => setActivityForm((f) => ({ ...f, name: e.target.value }))}
                                autoFocus
                              />
                            </div>
                            <div className="row">
                              <div className="field grow">
                                <label>Puntos máx.</label>
                                <input
                                  className="input"
                                  type="number"
                                  min="1"
                                  step="any"
                                  inputMode="decimal"
                                  value={activityForm.max_score}
                                  onChange={(e) => setActivityForm((f) => ({ ...f, max_score: e.target.value }))}
                                />
                              </div>
                              <div className="field grow">
                                <label>Fecha de entrega</label>
                                <input
                                  className="input"
                                  type="date"
                                  value={activityForm.due_date}
                                  onChange={(e) => setActivityForm((f) => ({ ...f, due_date: e.target.value }))}
                                />
                              </div>
                            </div>
                            <div className="row">
                              <button type="button" className="btn btn-ghost btn-sm grow" onClick={() => setActivityForm(null)}>
                                Cerrar
                              </button>
                              <button type="submit" className="btn btn-orange btn-sm grow">Agregar</button>
                            </div>
                          </form>
                        ) : (
                          <button
                            className="btn btn-ghost btn-sm btn-block"
                            style={{ marginTop: 8 }}
                            onClick={() => setActivityForm({ componentId: c.id, name: '', max_score: 10, due_date: '' })}
                          >
                            ＋ Nueva actividad
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}

            {componentForm ? (
              <form onSubmit={saveComponent} style={{ marginTop: 12 }}>
                <h2>{componentForm.id ? 'Editar componente' : 'Nuevo componente'}</h2>
                <div className="field">
                  <label htmlFor="c-name">Nombre</label>
                  <input
                    id="c-name"
                    className="input"
                    placeholder="Ej. Tareas"
                    value={componentForm.name}
                    onChange={(e) => setComponentForm((f) => ({ ...f, name: e.target.value }))}
                    autoFocus
                  />
                </div>
                <div className="row">
                  <div className="field grow">
                    <label htmlFor="c-kind">Tipo</label>
                    <select
                      id="c-kind"
                      className="input"
                      value={componentForm.kind}
                      onChange={(e) => setComponentForm((f) => ({ ...f, kind: e.target.value }))}
                    >
                      {COMPONENT_KINDS.map((k) => (
                        <option key={k.value} value={k.value}>{k.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field grow">
                    <label htmlFor="c-pct">Porcentaje (%)</label>
                    <input
                      id="c-pct"
                      className="input"
                      type="number"
                      min="1"
                      max="100"
                      inputMode="numeric"
                      placeholder="40"
                      value={componentForm.percentage}
                      onChange={(e) => setComponentForm((f) => ({ ...f, percentage: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="row">
                  <button type="button" className="btn btn-ghost grow" onClick={() => setComponentForm(null)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn btn-orange grow">Guardar</button>
                </div>
              </form>
            ) : (
              <button className="btn btn-orange btn-block" style={{ marginTop: 10 }} onClick={startNewComponent}>
                ＋ Nuevo componente
              </button>
            )}
          </div>
        </>
      )}
    </>
  )
}
