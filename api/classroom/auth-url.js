// GET /api/classroom/auth-url
// Genera la URL de autorización de Google para el docente autenticado.
// Deja una cookie con un nonce que el callback exige de vuelta: el flujo
// solo puede completarse en el mismo navegador que lo inició.
import {
  assertServerEnv,
  getUserFromRequest,
  oauthClient,
  signState,
  newNonce,
  nonceCookieHeader,
  CLASSROOM_SCOPES,
} from '../_lib/classroom.js'

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
    const nonce = newNonce()
    const url = oauthClient().generateAuthUrl({
      access_type: 'offline', // necesario para recibir refresh_token
      prompt: 'consent', // fuerza refresh_token también en reconexiones
      scope: CLASSROOM_SCOPES,
      state: signState(user.id, nonce),
    })
    res.setHeader('Set-Cookie', nonceCookieHeader(nonce))
    return res.status(200).json({ url })
  } catch (err) {
    console.error('[classroom/auth-url]', err)
    return res.status(500).json({ error: err.message })
  }
}
