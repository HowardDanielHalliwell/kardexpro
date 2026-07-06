// Utilidades compartidas por las funciones serverless de /api/classroom/*.
// Este código corre SOLO en Vercel (Node): aquí sí se usan el client secret
// de Google y la service role key de Supabase; nunca llegan al frontend.
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export const CLASSROOM_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.profile.emails',
]

export function assertServerEnv() {
  const missing = []
  if (!SUPABASE_URL) missing.push('VITE_SUPABASE_URL')
  if (!SUPABASE_ANON_KEY) missing.push('VITE_SUPABASE_ANON_KEY')
  if (!SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!process.env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID')
  if (!process.env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET')
  if (!process.env.GOOGLE_REDIRECT_URI) missing.push('GOOGLE_REDIRECT_URI')
  if (missing.length) {
    throw new Error(`Faltan variables de entorno en el servidor: ${missing.join(', ')}`)
  }
}

// Cliente con service role: salta RLS. Solo para uso interno del backend.
export function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    db: { schema: 'kardex' },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// Valida el JWT de Supabase que manda el frontend en Authorization: Bearer
export async function getUserFromRequest(req) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return null
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await anon.auth.getUser(token)
  if (error || !data?.user) return null
  return data.user
}

export function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )
}

// El "state" del flujo OAuth lleva el teacher_id firmado con HMAC para que
// el callback (que llega sin JWT, es un redirect del navegador desde Google)
// pueda verificar a quién pertenece sin confiar en datos manipulables.
const STATE_TTL_MS = 10 * 60 * 1000

function stateSignature(payload) {
  return crypto.createHmac('sha256', process.env.GOOGLE_CLIENT_SECRET).update(payload).digest('hex')
}

export function signState(teacherId) {
  const payload = `${teacherId}.${Date.now() + STATE_TTL_MS}`
  return `${payload}.${stateSignature(payload)}`
}

export function verifyState(state) {
  if (typeof state !== 'string') return null
  const parts = state.split('.')
  if (parts.length !== 3) return null
  const [teacherId, expiresAt, signature] = parts
  const expected = stateSignature(`${teacherId}.${expiresAt}`)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  if (Number(expiresAt) < Date.now()) return null
  return teacherId
}

// Devuelve un cliente de Classroom autenticado con el token guardado del
// docente. googleapis refresca solo el access_token cuando expira (usa el
// refresh_token) y aquí persistimos el token nuevo.
export async function getClassroomFor(teacherId) {
  const admin = adminClient()
  const { data: row, error } = await admin
    .from('classroom_tokens')
    .select('*')
    .eq('teacher_id', teacherId)
    .maybeSingle()
  if (error) throw new Error('No se pudo leer la conexión con Google: ' + error.message)
  if (!row) {
    const e = new Error('El docente aún no conecta su cuenta de Google Classroom.')
    e.code = 'no_conectado'
    throw e
  }

  const auth = oauthClient()
  auth.setCredentials({
    access_token: row.access_token,
    refresh_token: row.refresh_token || undefined,
    expiry_date: row.expiry ? new Date(row.expiry).getTime() : undefined,
  })
  auth.on('tokens', (tokens) => {
    const patch = {}
    if (tokens.access_token) patch.access_token = tokens.access_token
    if (tokens.refresh_token) patch.refresh_token = tokens.refresh_token
    if (tokens.expiry_date) patch.expiry = new Date(tokens.expiry_date).toISOString()
    if (Object.keys(patch).length) {
      admin.from('classroom_tokens').update(patch).eq('teacher_id', teacherId)
        .then(({ error: err }) => {
          if (err) console.error('[classroom] No se pudo persistir el token refrescado:', err.message)
        })
    }
  })

  return { classroom: google.classroom({ version: 'v1', auth }), admin }
}

export async function deleteToken(teacherId) {
  await adminClient().from('classroom_tokens').delete().eq('teacher_id', teacherId)
}

// Traduce los errores típicos de la API de Google a español accionable
export function googleErrorEs(err) {
  const msg = err?.response?.data?.error_description || err?.response?.data?.error?.message || err?.message || String(err)
  const code = err?.response?.status ?? err?.code
  if (/invalid_grant|invalid_rapt|token has been expired or revoked/i.test(msg) || code === 401) {
    return 'La conexión con Google expiró o fue revocada. Vuelve a presionar «Conectar con Google Classroom».'
  }
  if (code === 403) {
    return 'Google rechazó la operación: no eres docente de ese curso, o falta habilitar la Classroom API en el proyecto de Google Cloud.'
  }
  if (code === 404) {
    return 'El curso ya no existe en Google Classroom o perdiste acceso a él.'
  }
  if (code === 429) {
    return 'Google limitó las peticiones por exceso de llamadas. Espera un minuto y vuelve a intentar.'
  }
  return 'Error al comunicarse con Google Classroom: ' + msg
}

export function isInvalidGrant(err) {
  const msg = err?.response?.data?.error_description || err?.message || ''
  return /invalid_grant|token has been expired or revoked/i.test(msg) || err?.response?.status === 401
}
