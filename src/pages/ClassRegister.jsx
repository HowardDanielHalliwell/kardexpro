import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, TRIMESTERS, GRADE_STATUSES, CONDUCT_KINDS, pickAverage } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

function today() {
  return new Date().toISOString().slice(0, 10)
}

export default function ClassRegister() {
  const { user } = useAuth()
  const [groups, setGroups] = useState([])
  const [groupId, setGroupId] = useState('')
  const [subjects, setSubjects] = useState([])
  const [subjectId, setSubjectId] = useState('')
  const [trimester, setTrimester] = useState(1)
  const [activities, setActivities] = useState([]) // con nombre de componente
  const [activityId, setActivityId] = useState('')
  const [students, setStudents] = useState([])
  const [grades, setGrades] = useState({}) // student_id -> {id?, status, score}
  const [averages, setAverages] = useState({}) // student_id -> number
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Modal de conducta
  const [conductOpen, setConductOpen] = useState(false)
  const [conduct, setConduct] = useState({ studentId: '', kind: '', score: 0, note: '' })
  const [savingConduct, setSavingConduct] = useState(false)
  const [conductToast, setConductToast] = useState('')
  const toastTimer = useRef(null)

  useEffect(() => () => clearTimeout(toastTimer.current), [])

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

  // Materias y alumnos del grupo
  useEffect(() => {
    setSubjects([])
    setSubjectId('')
    setStudents([])
    if (!groupId) return
    supabase.from('subjects').select('*').eq('group_id', groupId).order('name').then(({ data }) => {
      setSubjects(data ?? [])
      if (data?.length === 1) setSubjectId(data[0].id)
    })
    supabase
      .from('students')
      .select('*')
      .eq('group_id', groupId)
      .eq('active', true)
      .order('list_number')
      .then(({ data }) => setStudents(data ?? []))
  }, [groupId])

  // Actividades de la materia+trimestre (vía componentes)
  useEffect(() => {
    setActivities([])
    setActivityId('')
    if (!subjectId) return
    async function load() {
      const { data: comps } = await supabase
        .from('evaluation_components')
        .select('*')
        .eq('subject_id', subjectId)
        .eq('trimester', trimester)
        .order('sort_order')
      const compIds = (comps ?? []).map((c) => c.id)
      if (compIds.length === 0) return
      const { data: acts } = await supabase
        .from('activities')
        .select('*')
        .in('component_id', compIds)
        .order('sort_order')
      const byId = Object.fromEntries((comps ?? []).map((c) => [c.id, c]))
      const list = (acts ?? []).map((a) => ({ ...a, componentName: byId[a.component_id]?.name ?? '' }))
      setActivities(list)
      if (list.length > 0) setActivityId(list[0].id)
    }
    load()
  }, [subjectId, trimester])

  // Calificaciones de la actividad seleccionada
  useEffect(() => {
    setGrades({})
    if (!activityId) return
    setLoading(true)
    supabase
      .from('student_grades')
      .select('*')
      .eq('activity_id', activityId)
      .then(({ data, error: err }) => {
        if (err) setError('No se pudieron cargar las calificaciones: ' + err.message)
        const map = {}
        for (const g of data ?? []) map[g.student_id] = g
        setGrades(map)
        setLoading(false)
      })
  }, [activityId])

  // Promedios desde la vista v_student_averages (ya ponderados en la DB)
  useEffect(() => {
    setAverages({})
    if (!subjectId) return
    supabase
      .from('v_student_averages')
      .select('*')
      .eq('subject_id', subjectId)
      .eq('trimester', trimester)
      .then(({ data, error: err }) => {
        if (err || !data) return // si la vista no filtra así, simplemente no mostramos promedios
        const map = {}
        for (const row of data) {
          const value = pickAverage(row)
          if (row.student_id && value != null) map[row.student_id] = value
        }
        setAverages(map)
      })
  }, [subjectId, trimester])

  const activity = useMemo(() => activities.find((a) => a.id === activityId), [activities, activityId])

  // Guardado optimista: la UI cambia al instante y se revierte solo si falla
  async function setStatus(student, status) {
    const prev = grades[student.id]
    const isSame = prev?.status === status
    const nextStatus = isSame ? 'pending' : status
    const nextScore =
      nextStatus === 'delivered'
        ? prev?.score ?? Number(activity?.max_score ?? 0)
        : nextStatus === 'missing'
          ? 0
          : prev?.score ?? null

    const optimistic = { ...(prev ?? { student_id: student.id, activity_id: activityId }), status: nextStatus, score: nextScore }
    setGrades((m) => ({ ...m, [student.id]: optimistic }))

    try {
      if (prev?.id) {
        const { error: err } = await supabase
          .from('student_grades')
          .update({ status: nextStatus, score: nextScore })
          .eq('id', prev.id)
        if (err) throw err
      } else {
        const { data, error: err } = await supabase
          .from('student_grades')
          .insert({ student_id: student.id, activity_id: activityId, status: nextStatus, score: nextScore })
          .select()
          .single()
        if (err) throw err
        setGrades((m) => ({ ...m, [student.id]: data }))
      }
    } catch (err) {
      setGrades((m) => ({ ...m, [student.id]: prev }))
      setError('No se pudo guardar: ' + err.message)
    }
  }

  function setLocalScore(studentId, raw) {
    setGrades((m) => ({
      ...m,
      [studentId]: { ...(m[studentId] ?? { student_id: studentId, activity_id: activityId, status: 'delivered' }), score: raw === '' ? null : Number(raw) },
    }))
  }

  async function persistScore(student) {
    const g = grades[student.id]
    if (!g) return
    const max = Number(activity?.max_score ?? Infinity)
    let score = g.score
    if (score != null && score > max) {
      score = max
      setGrades((m) => ({ ...m, [student.id]: { ...m[student.id], score } }))
    }
    try {
      if (g.id) {
        const { error: err } = await supabase.from('student_grades').update({ score, status: g.status }).eq('id', g.id)
        if (err) throw err
      } else {
        const { data, error: err } = await supabase
          .from('student_grades')
          .insert({ student_id: student.id, activity_id: activityId, status: g.status ?? 'delivered', score })
          .select()
          .single()
        if (err) throw err
        setGrades((m) => ({ ...m, [student.id]: data }))
      }
    } catch (err) {
      setError('No se pudo guardar la puntuación: ' + err.message)
    }
  }

  function openConduct(studentId = '') {
    setConduct({ studentId, kind: '', score: 0, note: '' })
    setConductOpen(true)
  }

  async function saveConduct(e) {
    e.preventDefault()
    setError('')
    if (!conduct.studentId) {
      setError('Elige a un alumno.')
      return
    }
    if (!conduct.kind) {
      setError('Elige el tipo de registro.')
      return
    }
    setSavingConduct(true)
    const { error: err } = await supabase.from('conduct_logs').insert({
      student_id: conduct.studentId,
      subject_id: subjectId,
      trimester,
      log_date: today(),
      kind: conduct.kind,
      score: Number(conduct.score) || 0,
      note: conduct.note.trim() || null,
    })
    setSavingConduct(false)
    if (err) {
      setError('No se pudo registrar la conducta: ' + err.message)
      return
    }
    setConductOpen(false)
    const student = students.find((s) => s.id === conduct.studentId)
    setConductToast(`Conducta registrada para ${student?.full_name ?? 'el alumno'} ✓`)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setConductToast(''), 3000)
  }

  const ready = groupId && subjectId

  return (
    <>
      <h1 className="page-title">Registro de clase</h1>

      {error && (
        <div className="alert alert-error" onClick={() => setError('')}>
          {error}
        </div>
      )}
      {conductToast && <div className="alert alert-success">{conductToast}</div>}

      <div className="card">
        <div className="row">
          <div className="field grow">
            <label htmlFor="r-group">Grupo</label>
            <select id="r-group" className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">— Grupo —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
          <div className="field grow">
            <label htmlFor="r-subject">Materia</label>
            <select id="r-subject" className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">— Materia —</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>

        {ready && (
          <>
            <div className="segments" style={{ marginBottom: 12 }}>
              {TRIMESTERS.map((t) => (
                <button key={t} className={trimester === t ? 'active' : ''} onClick={() => setTrimester(t)}>
                  {t}° trim
                </button>
              ))}
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="r-activity">Actividad</label>
              <select id="r-activity" className="input" value={activityId} onChange={(e) => setActivityId(e.target.value)}>
                {activities.length === 0 && <option value="">Sin actividades en este trimestre</option>}
                {activities.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.componentName ? `${a.componentName} · ` : ''}{a.name} (máx {Number(a.max_score)})
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      {!ready ? (
        <div className="card empty-state">
          <span className="icon" aria-hidden="true">🏫</span>
          Elige grupo y materia para pasar registro.
        </div>
      ) : activities.length === 0 ? (
        <div className="card empty-state">
          <span className="icon" aria-hidden="true">📚</span>
          No hay actividades en este trimestre. Créalas en la pestaña <b>Materias</b>.
        </div>
      ) : loading ? (
        <div className="center"><span className="spinner" /></div>
      ) : (
        <div className="card">
          <h2>
            Alumnos ({students.length})
            {activity && <span className="muted" style={{ fontWeight: 500 }}> · {activity.name}</span>}
          </h2>
          {students.length === 0 && (
            <div className="empty-state">
              <span className="icon" aria-hidden="true">🧑‍🎓</span>
              Este grupo no tiene alumnos activos.
            </div>
          )}
          {students.map((s) => {
            const g = grades[s.id]
            const status = g?.status
            const showScore = status === 'delivered' || status === 'late'
            return (
              <div key={s.id} className="list-item" style={{ flexWrap: 'wrap' }}>
                <span className="list-number">{s.list_number}</span>
                <span className="student-name">
                  {s.full_name}
                  {averages[s.id] != null && (
                    <span className="avg-badge" style={{ marginLeft: 8 }} title="Promedio del trimestre">
                      {averages[s.id].toFixed(1)}
                    </span>
                  )}
                </span>
                <div className="chip-group" style={{ width: '100%', paddingLeft: 46 }}>
                  {GRADE_STATUSES.map((st) => (
                    <button
                      key={st.value}
                      className={`chip ${status === st.value ? `on-${st.value} chip-selected` : ''}`}
                      onClick={() => setStatus(s, st.value)}
                      aria-pressed={status === st.value}
                      title={st.label}
                    >
                      {st.label}
                    </button>
                  ))}
                  {showScore && (
                    <input
                      className="score-input"
                      type="number"
                      min="0"
                      max={Number(activity?.max_score ?? 100)}
                      step="any"
                      inputMode="decimal"
                      aria-label={`Puntuación de ${s.full_name}`}
                      placeholder={String(Number(activity?.max_score ?? ''))}
                      value={g?.score ?? ''}
                      onChange={(e) => setLocalScore(s.id, e.target.value)}
                      onBlur={() => persistScore(s)}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {ready && students.length > 0 && (
        <button className="fab" onClick={() => openConduct()}>
          ＋ Conducta
        </button>
      )}

      {conductOpen && (
        <div className="modal-backdrop" onClick={() => setConductOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Registrar conducta</h3>

            <div className="field">
              <label htmlFor="cd-student">Alumno</label>
              <select
                id="cd-student"
                className="input"
                value={conduct.studentId}
                onChange={(e) => setConduct((c) => ({ ...c, studentId: e.target.value }))}
              >
                <option value="">— Elige alumno —</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>{s.list_number}. {s.full_name}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Tipo</label>
              <div className="chip-group">
                {CONDUCT_KINDS.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    className={`chip ${conduct.kind === k.value ? 'on-pending chip-selected' : ''}`}
                    onClick={() => setConduct((c) => ({ ...c, kind: k.value, score: k.defaultScore }))}
                  >
                    {k.emoji} {k.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label htmlFor="cd-score">Puntos (+/-)</label>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-label="Restar un punto"
                  onClick={() => setConduct((c) => ({ ...c, score: (Number(c.score) || 0) - 1 }))}
                >
                  −
                </button>
                <input
                  id="cd-score"
                  className="input"
                  style={{ textAlign: 'center', fontWeight: 800 }}
                  type="number"
                  inputMode="numeric"
                  value={conduct.score}
                  onChange={(e) => setConduct((c) => ({ ...c, score: e.target.value }))}
                />
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-label="Sumar un punto"
                  onClick={() => setConduct((c) => ({ ...c, score: (Number(c.score) || 0) + 1 }))}
                >
                  ＋
                </button>
              </div>
            </div>

            <div className="field">
              <label htmlFor="cd-note">Comentario (opcional)</label>
              <textarea
                id="cd-note"
                className="input"
                placeholder="Ej. Interrumpió la clase repetidamente"
                value={conduct.note}
                onChange={(e) => setConduct((c) => ({ ...c, note: e.target.value }))}
              />
            </div>

            <div className="row">
              <button className="btn btn-ghost grow" onClick={() => setConductOpen(false)}>
                Cancelar
              </button>
              <button className="btn btn-orange grow" onClick={saveConduct} disabled={savingConduct}>
                {savingConduct ? 'Guardando…' : 'Registrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
