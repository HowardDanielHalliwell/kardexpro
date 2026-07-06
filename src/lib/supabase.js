import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Detecta tanto variables ausentes como los placeholders de .env.example
// que quedaron sin reemplazar (TU-PROYECTO / TU_ANON_KEY_AQUI).
const isPlaceholder = (v) => !v || /TU[-_](PROYECTO|ANON)/i.test(v)
export const isSupabaseConfigured = !isPlaceholder(url) && !isPlaceholder(anonKey)

export const CONFIG_ERROR_ES =
  'Supabase no está configurado: el archivo .env no existe, no se guardó, ' +
  'o aún tiene los valores de ejemplo (TU-PROYECTO / TU_ANON_KEY_AQUI). ' +
  'Edita .env con tus credenciales reales, guárdalo y reinicia npm run dev.'

if (!isSupabaseConfigured) {
  console.error('[KardexPro] ' + CONFIG_ERROR_ES, {
    VITE_SUPABASE_URL: url ?? '(undefined)',
    VITE_SUPABASE_ANON_KEY: anonKey ? anonKey.slice(0, 8) + '…' : '(undefined)',
  })
}

// Las tablas de KardexPro viven en el schema dedicado "kardex"
// (el proyecto Supabase es compartido con otra app).
export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing', {
  db: { schema: 'kardex' },
})

export const TRIMESTERS = [1, 2, 3]

export const COMPONENT_KINDS = [
  { value: 'exam', label: 'Examen' },
  { value: 'simple', label: 'Simple' },
  { value: 'integradora', label: 'Integradora' },
  { value: 'extra', label: 'Extra' },
]

export const GRADE_STATUSES = [
  { value: 'delivered', label: 'Entregada', short: '✓' },
  { value: 'late', label: 'Tarde', short: 'T' },
  { value: 'pending', label: 'Pendiente', short: '…' },
  { value: 'missing', label: 'Falta', short: '✗' },
]

export const CONDUCT_KINDS = [
  { value: 'participacion_destacada', label: 'Participación destacada', emoji: '⭐', defaultScore: 1 },
  { value: 'apoyo_companeros', label: 'Apoyo a compañeros', emoji: '🤝', defaultScore: 1 },
  { value: 'disrupcion', label: 'Disrupción', emoji: '🔊', defaultScore: -1 },
  { value: 'falta_material', label: 'Falta de material', emoji: '📦', defaultScore: -1 },
  { value: 'falta_respeto', label: 'Falta de respeto', emoji: '🚫', defaultScore: -2 },
  { value: 'otro', label: 'Otro', emoji: '📝', defaultScore: 0 },
]

// v_student_averages ya calcula el promedio ponderado en la base de datos.
// Esta función localiza el valor numérico del promedio sin asumir el nombre
// exacto de la columna en la vista.
const AVG_KEYS = ['average', 'avg', 'promedio', 'weighted_average', 'final_average', 'trimester_average']
export function pickAverage(row) {
  if (!row) return null
  for (const key of AVG_KEYS) {
    if (typeof row[key] === 'number') return row[key]
    if (row[key] != null && !Number.isNaN(Number(row[key]))) return Number(row[key])
  }
  for (const [key, value] of Object.entries(row)) {
    if (/id$|^trimester$|number/i.test(key)) continue
    const n = Number(value)
    if (typeof value !== 'string' && !Number.isNaN(n) && value !== null) return n
  }
  return null
}
