// GET /api/classroom/courses
// Lista los cursos activos donde el docente es profesor.
// Responde { connected: false } si aún no ha conectado su cuenta.
import { assertServerEnv, getUserFromRequest, getClassroomFor, googleErrorEs, isInvalidGrant, deleteToken } from '../_lib/classroom.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido.' })
  }
  try {
    assertServerEnv()
    const user = await getUserFromRequest(req)
    if (!user) {
      return res.status(401).json({ error: 'Sesión inválida. Vuelve a iniciar sesión en KardexPro.' })
    }

    let classroom
    try {
      ;({ classroom } = await getClassroomFor(user.id))
    } catch (err) {
      if (err.code === 'no_conectado') return res.status(200).json({ connected: false, courses: [] })
      throw err
    }

    const courses = []
    let pageToken
    try {
      do {
        const { data } = await classroom.courses.list({
          teacherId: 'me',
          courseStates: ['ACTIVE'],
          pageSize: 50,
          pageToken,
        })
        courses.push(...(data.courses ?? []))
        pageToken = data.nextPageToken
      } while (pageToken)
    } catch (err) {
      if (isInvalidGrant(err)) {
        // El refresh_token fue revocado: borramos la conexión para que la UI
        // vuelva a ofrecer el botón de conectar
        await deleteToken(user.id)
        return res.status(200).json({ connected: false, courses: [], error: googleErrorEs(err) })
      }
      throw err
    }

    return res.status(200).json({
      connected: true,
      courses: courses.map((c) => ({ id: c.id, name: c.name, section: c.section ?? null })),
    })
  } catch (err) {
    console.error('[classroom/courses]', err)
    return res.status(500).json({ error: googleErrorEs(err) })
  }
}
