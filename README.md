# KardexPro

PWA de control de calificaciones para docentes — suite **Genius Cooper™**, Colegio Mano Amiga Chalco.

Permite gestionar grupos y alumnos (alta manual o importación desde Excel/CSV), configurar materias con componentes de evaluación ponderados por trimestre (validando que sumen 100%), pasar registro de entregas con un toque (optimista, pensado para usarse con una mano en el salón) y registrar incidencias de conducta.

## Stack

- **Vite + React 18** (JavaScript)
- **react-router-dom v6**
- **Supabase** (`@supabase/supabase-js` v2) — las tablas viven en el schema dedicado `kardex`
- **vite-plugin-pwa** — instalable, actualización automática
- **SheetJS (xlsx)** — importación de listas de alumnos
- CSS puro con variables (sin frameworks)

## Requisitos

- Node.js 18+
- Un proyecto de Supabase con el schema `kardex` ya creado (tablas: `profiles`, `groups`, `students`, `subjects`, `evaluation_components`, `activities`, `student_grades`, `conduct_logs` y la vista `v_student_averages`). El schema `kardex` debe estar **expuesto en la Data API** (Dashboard → Settings → API → Exposed schemas).

## Setup local

```bash
git clone https://github.com/HowardDanielHalliwell/kardexpro.git
cd kardexpro
npm install
cp .env.example .env   # en Windows: copy .env.example .env
```

Edita `.env` con tus credenciales reales (Dashboard de Supabase → Project Settings → API):

```
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

## Correr en desarrollo

```bash
npm run dev
```

Abre http://localhost:5173. Crea una cuenta desde la pestaña **«Crear cuenta»** del login (si tu proyecto Supabase exige confirmación por correo, revisa tu bandeja antes de entrar).

## Build de producción

```bash
npm run build    # genera dist/
npm run preview  # sirve el build localmente
```

## Deploy a Vercel

1. Sube el repo a GitHub.
2. En [vercel.com](https://vercel.com) → **Add New → Project** → importa el repo. Vercel detecta Vite automáticamente (build `npm run build`, output `dist`).
3. En **Environment Variables** agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (Production, Preview y Development).
4. Deploy. El archivo `vercel.json` ya incluye el rewrite para que las rutas del router funcionen al recargar.

O con CLI: `npm i -g vercel && vercel --prod` (agrega las variables con `vercel env add`).

## Estructura

```
src/
  lib/supabase.js        Cliente Supabase (schema kardex) y constantes de dominio
  context/AuthContext.jsx Sesión, login/registro, errores traducidos al español
  components/             Layout (nav inferior) y ProtectedRoute
  pages/
    Login.jsx             Iniciar sesión / crear cuenta
    Home.jsx              Saludo + grupos recientes
    Groups.jsx            Lista y alta de grupos
    GroupDetail.jsx       Alumnos: alta en cadena, importación .xlsx/.csv con preview, baja lógica
    SubjectConfig.jsx     Materias, componentes por trimestre (Total X%/100%) y actividades
    ClassRegister.jsx     Pase de lista con chips por actividad + registro de conducta
    Settings.jsx          Cerrar sesión
scripts/generate-icons.mjs  Regenera los íconos PWA placeholder (npm run icons)
```

## Notas

- Los promedios se leen de la vista `v_student_averages` (ponderación calculada en la base de datos, no en el frontend).
- La suma de porcentajes por materia+trimestre se valida en el cliente **y** en la base de datos (trigger).
- La baja de alumnos es lógica (`active = false`): las calificaciones se conservan y el alumno puede reactivarse.
