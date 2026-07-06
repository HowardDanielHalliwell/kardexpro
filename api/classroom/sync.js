// POST /api/classroom/sync  { subjectId, trimester? }
// Sincronización de un solo sentido: Classroom → KardexPro.
// Classroom es la fuente de verdad de "quién entregó qué"; la calificación
// (score) se captura en KardexPro y aquí NUNCA se sobreescribe.
import { assertServerEnv, getUserFromRequest, getClassroomFor, googleErrorEs } from '../_lib/classroom.js'

// Fecha límite de una tarea de Classroom en milisegundos UTC (o null)
function courseworkDueMs(cw) {
  if (!cw.dueDate?.year) return null
  const { year, month, day } = cw.dueDate
  const hours = cw.dueTime?.hours ?? 23
  const minutes = cw.dueTime?.minutes ?? 59
  return Date.UTC(year, month - 1, day, hours, minutes)
}

function courseworkDueDateStr(cw) {
  if (!cw.dueDate?.year) return null
  const pad = (n) => String(n).padStart(2, '0')
  return `${cw.dueDate.year}-${pad(cw.dueDate.month)}-${pad(cw.dueDate.day)}`
}

// TURNED_IN/RETURNED → delivered (o late si Classroom marca la entrega tardía);
// sin entrega → missing si ya venció, pending si no
function mapStatus(submission, dueMs) {
  if (submission.state === 'TURNED_IN' || submission.state === 'RETURNED') {
    return submission.late ? 'late' : 'delivered'
  }
  if (dueMs && Date.now() > dueMs) return 'missing'
  return 'pending'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' })
  }
  try {
    assertServerEnv()
    const user = await getUserFromRequest(req)
    if (!user) {
      return res.status(401).json({ error: 'Sesión inválida. Vuelve a iniciar sesión en KardexPro.' })
    }
    const { subjectId, trimester = 1 } = req.body ?? {}
    if (!subjectId) {
      return res.status(400).json({ error: 'Falta el parámetro subjectId.' })
    }

    let classroom, admin
    try {
      ;({ classroom, admin } = await getClassroomFor(user.id))
    } catch (err) {
      if (err.code === 'no_conectado') {
        return res.status(400).json({ error: 'Primero conecta tu cuenta de Google Classroom.' })
      }
      throw err
    }

    const { data: subject } = await admin.from('subjects').select('*').eq('id', subjectId).maybeSingle()
    if (!subject) return res.status(404).json({ error: 'Materia no encontrada.' })
    if (subject.teacher_id !== user.id) {
      return res.status(403).json({ error: 'Esta materia no pertenece a tu cuenta.' })
    }
    if (!subject.google_classroom_id) {
      return res.status(400).json({ error: 'La materia aún no está vinculada a un curso de Classroom.' })
    }
    const courseId = subject.google_classroom_id

    // Componentes de la materia: las actividades existentes se emparejan por
    // google_classroom_coursework_id en cualquier trimestre; las nuevas se
    // crean en el primer componente 'simple' del trimestre indicado
    const { data: components } = await admin
      .from('evaluation_components')
      .select('*')
      .eq('subject_id', subjectId)
    const trimComponents = (components ?? []).filter((c) => Number(c.trimester) === Number(trimester))
    const targetComponent = trimComponents.find((c) => c.kind === 'simple') ?? trimComponents[0] ?? null

    const componentIds = (components ?? []).map((c) => c.id)
    let activities = []
    if (componentIds.length) {
      const { data } = await admin.from('activities').select('*').in('component_id', componentIds)
      activities = data ?? []
    }
    const activityByCourseworkId = new Map(
      activities.filter((a) => a.google_classroom_coursework_id).map((a) => [a.google_classroom_coursework_id, a])
    )
    let nextSortOrder = targetComponent
      ? activities.filter((a) => a.component_id === targetComponent.id).length
      : 0

    // Alumnos del grupo (emparejamiento por correo, sin distinguir mayúsculas)
    const { data: students } = await admin
      .from('students')
      .select('id, email, full_name')
      .eq('group_id', subject.group_id)
      .eq('active', true)
    const studentsByEmail = new Map(
      (students ?? []).filter((s) => s.email).map((s) => [s.email.trim().toLowerCase(), s])
    )

    // Roster de Classroom: userId → correo
    const rosterEmail = new Map()
    let pageToken
    do {
      const { data } = await classroom.courses.students.list({ courseId, pageSize: 100, pageToken })
      for (const st of data.students ?? []) {
        const email = st.profile?.emailAddress?.trim().toLowerCase()
        if (email) rosterEmail.set(st.userId, email)
      }
      pageToken = data.nextPageToken
    } while (pageToken)

    // Tareas del curso
    const courseworks = []
    pageToken = undefined
    do {
      const { data } = await classroom.courses.courseWork.list({ courseId, pageSize: 100, pageToken })
      courseworks.push(...(data.courseWork ?? []))
      pageToken = data.nextPageToken
    } while (pageToken)

    let actividadesCreadas = 0
    let calificacionesActualizadas = 0
    const alumnosSinCoincidencia = new Set()

    for (const cw of courseworks) {
      let activity = activityByCourseworkId.get(cw.id)
      if (!activity) {
        if (!targetComponent) {
          return res.status(400).json({
            error:
              `No hay componentes de evaluación en el trimestre ${trimester} de esta materia. ` +
              'Crea al menos un componente (idealmente tipo «simple») antes de sincronizar.',
          })
        }
        const { data: created, error: createErr } = await admin
          .from('activities')
          .insert({
            component_id: targetComponent.id,
            name: cw.title?.slice(0, 200) || 'Tarea de Classroom',
            max_score: cw.maxPoints ?? 10,
            due_date: courseworkDueDateStr(cw),
            google_classroom_coursework_id: cw.id,
            sort_order: nextSortOrder++,
          })
          .select()
          .single()
        if (createErr) {
          return res.status(500).json({ error: 'No se pudo crear la actividad «' + cw.title + '»: ' + createErr.message })
        }
        activity = created
        activityByCourseworkId.set(cw.id, activity)
        actividadesCreadas++
      }

      // Entregas de esta tarea
      const submissions = []
      let subToken
      do {
        const { data } = await classroom.courses.courseWork.studentSubmissions.list({
          courseId,
          courseWorkId: cw.id,
          pageSize: 100,
          pageToken: subToken,
        })
        submissions.push(...(data.studentSubmissions ?? []))
        subToken = data.nextPageToken
      } while (subToken)
      if (submissions.length === 0) continue

      const { data: existingGrades } = await admin
        .from('student_grades')
        .select('id, student_id, status')
        .eq('activity_id', activity.id)
      const gradeByStudent = new Map((existingGrades ?? []).map((g) => [g.student_id, g]))

      const dueMs = courseworkDueMs(cw)
      const inserts = []
      for (const sub of submissions) {
        const email = rosterEmail.get(sub.userId)
        const student = email ? studentsByEmail.get(email) : null
        if (!student) {
          if (email) alumnosSinCoincidencia.add(email)
          continue
        }
        const status = mapStatus(sub, dueMs)
        const existing = gradeByStudent.get(student.id)
        if (existing) {
          // Solo se actualiza el estado de entrega; el score capturado en
          // KardexPro se respeta siempre
          if (existing.status !== status) {
            const { error: updErr } = await admin.from('student_grades').update({ status }).eq('id', existing.id)
            if (!updErr) calificacionesActualizadas++
          }
        } else {
          inserts.push({ student_id: student.id, activity_id: activity.id, status, score: null })
        }
      }
      if (inserts.length) {
        const { error: insErr } = await admin.from('student_grades').insert(inserts)
        if (insErr) {
          return res.status(500).json({ error: 'No se pudieron guardar las entregas: ' + insErr.message })
        }
        calificacionesActualizadas += inserts.length
      }
    }

    await admin
      .from('subjects')
      .update({ google_classroom_synced_at: new Date().toISOString() })
      .eq('id', subjectId)

    return res.status(200).json({
      actividadesCreadas,
      calificacionesActualizadas,
      alumnosSinCoincidencia: [...alumnosSinCoincidencia],
    })
  } catch (err) {
    console.error('[classroom/sync]', err)
    return res.status(500).json({ error: googleErrorEs(err) })
  }
}
