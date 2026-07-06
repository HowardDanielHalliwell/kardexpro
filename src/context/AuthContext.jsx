import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

const AUTH_ERRORS_ES = [
  [/invalid login credentials/i, 'Correo o contraseña incorrectos.'],
  [/email not confirmed/i, 'Tu correo aún no está confirmado. Revisa tu bandeja de entrada.'],
  [/user already registered/i, 'Ya existe una cuenta con este correo.'],
  [/password should be at least/i, 'La contraseña debe tener al menos 6 caracteres.'],
  [/unable to validate email|invalid format|invalid email/i, 'El correo no tiene un formato válido.'],
  [/rate limit|too many requests/i, 'Demasiados intentos. Espera un momento e inténtalo de nuevo.'],
  [/signup.*disabled/i, 'El registro de cuentas nuevas está deshabilitado.'],
  [/network|fetch/i, 'No hay conexión con el servidor. Revisa tu internet.'],
]

export function translateAuthError(error) {
  const msg = error?.message ?? String(error ?? '')
  for (const [pattern, text] of AUTH_ERRORS_ES) {
    if (pattern.test(msg)) return text
  }
  return `Ocurrió un error inesperado. Inténtalo de nuevo. (${msg})`
}

async function ensureProfile(user) {
  const fallback = {
    id: user.id,
    full_name: user.user_metadata?.full_name || user.email,
    role: 'teacher',
  }
  try {
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    if (data) return data
    const { data: created } = await supabase.from('profiles').insert(fallback).select().maybeSingle()
    return created ?? fallback
  } catch {
    return fallback
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => subscription.unsubscribe()
  }, [])

  const userId = session?.user?.id
  useEffect(() => {
    if (!userId) {
      setProfile(null)
      return
    }
    let cancelled = false
    ensureProfile(session.user).then((p) => {
      if (!cancelled) setProfile(p)
    })
    return () => { cancelled = true }
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(translateAuthError(error))
  }

  async function signUp(email, password, fullName) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })
    if (error) throw new Error(translateAuthError(error))
    // Si el proyecto exige confirmación por correo, no hay sesión todavía
    return { needsConfirmation: !data.session }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    signIn,
    signUp,
    signOut,
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
