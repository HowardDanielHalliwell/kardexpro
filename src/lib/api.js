import { supabase } from './supabase'

// Llama a las funciones serverless de /api/classroom/* mandando el JWT de
// Supabase del docente. El backend valida ese token antes de hacer nada.
export async function apiClassroom(path, { method = 'GET', body } = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.')

  let res
  try {
    res = await fetch(`/api/classroom/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('No se pudo contactar al servidor de la app. Revisa tu conexión.')
  }

  let data = null
  try {
    data = await res.json()
  } catch {
    // respuesta sin cuerpo JSON (p. ej. 404 del dev server de Vite)
  }
  if (!res.ok) {
    throw new Error(
      data?.error ||
        `Error del servidor (${res.status}). Nota: con «npm run dev» las funciones /api no corren; ` +
          'usa «npx vercel dev» o prueba en el sitio desplegado en Vercel.'
    )
  }
  return data
}
