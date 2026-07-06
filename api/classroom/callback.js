// GET /api/classroom/callback
// Google redirige aquí con ?code&state. Intercambia el code por tokens y los
// guarda en kardex.classroom_tokens (service role). El navegador vuelve a
// /materias con un flag de resultado.
import {
  assertServerEnv,
  oauthClient,
  verifyState,
  adminClient,
  nonceFromCookies,
  nonceCookieHeader,
} from '../_lib/classroom.js'

export default async function handler(req, res) {
  const appOrigin = process.env.GOOGLE_REDIRECT_URI
    ? new URL(process.env.GOOGLE_REDIRECT_URI).origin
    : ''

  const redirect = (params) => {
    res.statusCode = 302
    res.setHeader('Set-Cookie', nonceCookieHeader(null)) // el nonce es de un solo uso
    res.setHeader('Location', `${appOrigin}/materias?${new URLSearchParams(params)}`)
    res.end()
  }
  const fail = (motivo) => redirect({ classroom: 'error', motivo })

  try {
    assertServerEnv()
    const { code, state, error } = req.query ?? {}
    if (error === 'access_denied') return fail('Cancelaste la autorización en Google.')
    if (error) return fail('Google devolvió un error: ' + error)
    if (!code) return fail('Google no envió el código de autorización.')

    const teacherId = verifyState(state, nonceFromCookies(req))
    if (!teacherId) return fail('El enlace de autorización expiró o no es válido. Intenta conectar de nuevo.')

    const { tokens } = await oauthClient().getToken(code)

    const admin = adminClient()
    const { data: existing } = await admin
      .from('classroom_tokens')
      .select('teacher_id, refresh_token')
      .eq('teacher_id', teacherId)
      .maybeSingle()

    const row = {
      teacher_id: teacherId,
      access_token: tokens.access_token,
      // Google solo manda refresh_token la primera vez (o con prompt=consent);
      // si no llega, conservamos el que ya teníamos
      refresh_token: tokens.refresh_token ?? existing?.refresh_token ?? null,
      expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      scope: tokens.scope ?? null,
    }

    const { error: dbError } = existing
      ? await admin.from('classroom_tokens').update(row).eq('teacher_id', teacherId)
      : await admin.from('classroom_tokens').insert(row)
    if (dbError) return fail('No se pudo guardar la conexión: ' + dbError.message)

    return redirect({ classroom: 'conectado' })
  } catch (err) {
    console.error('[classroom/callback]', err)
    return fail('No se pudo completar la conexión con Google. Intenta de nuevo.')
  }
}
