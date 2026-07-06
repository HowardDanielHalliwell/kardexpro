# KardexPro

PWA de control de calificaciones para docentes — suite **Genius Cooper™**, Colegio Mano Amiga Chalco.

Permite gestionar grupos y alumnos (alta manual o importación desde Excel/CSV), configurar materias con componentes de evaluación ponderados por trimestre (validando que sumen 100%), pasar registro de entregas con un toque (optimista, pensado para usarse con una mano en el salón), registrar incidencias de conducta y **sincronizar entregas desde Google Classroom** (un solo sentido: Classroom → KardexPro).

## Stack

- **Vite + React 18** (JavaScript)
- **react-router-dom v6**
- **Supabase** (`@supabase/supabase-js` v2) — las tablas viven en el schema dedicado `kardex`
- **vite-plugin-pwa** — instalable, actualización automática
- **SheetJS (xlsx)** — importación de listas de alumnos
- **googleapis** — integración con Google Classroom vía funciones serverless de Vercel (`api/`)
- CSS puro con variables (sin frameworks)

## Requisitos

- Node.js 18+
- Un proyecto de Supabase con el schema `kardex` ya creado (tablas: `profiles`, `groups`, `students`, `subjects`, `evaluation_components`, `activities`, `student_grades`, `conduct_logs` y la vista `v_student_averages`). El schema `kardex` debe estar **expuesto en la Data API** (Dashboard → Settings → API → Exposed schemas).
- Para la integración con Google Classroom: ejecuta `db/classroom.sql` en el **SQL Editor** de Supabase (agrega `students.email`, las columnas `google_classroom_*` y la tabla `classroom_tokens`) y sigue la sección [Google Classroom](#google-classroom) de abajo.

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
3. En **Environment Variables** agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (Production, Preview y Development). Para Classroom agrega también `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_REDIRECT_URI` (ver sección siguiente).
4. Deploy. El archivo `vercel.json` ya incluye el rewrite para que las rutas del router funcionen al recargar (las funciones de `api/` tienen prioridad sobre ese rewrite).

O con CLI: `npm i -g vercel && vercel --prod` (agrega las variables con `vercel env add`).

## Google Classroom

La sincronización es de **un solo sentido** (Classroom → KardexPro) y de **solo lectura** en Google: trae las tareas del curso como actividades y marca cada entrega como Entregada/Tarde/Pendiente/Falta según su estado y fecha límite. Las calificaciones capturadas en KardexPro **nunca** se sobreescriben, y nada se escribe en Classroom.

Setup (una sola vez):

1. **Base de datos**: ejecuta `db/classroom.sql` en Supabase → SQL Editor.
2. **Google Cloud Console** ([console.cloud.google.com](https://console.cloud.google.com)):
   - Crea un proyecto (o usa uno existente) y habilita la **Google Classroom API** (APIs & Services → Library).
   - Configura la **OAuth consent screen** (tipo External; agrega los scopes de Classroom de solo lectura; mientras esté en modo Testing, agrega los correos de los docentes como test users).
   - Crea credenciales **OAuth 2.0 Client ID** de tipo *Web application* y agrega como **Authorized redirect URI**: `https://TU-APP.vercel.app/api/classroom/callback`.
3. **Variables de entorno en Vercel**: `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Settings → API), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_REDIRECT_URI` (el mismo redirect URI del paso anterior).

Uso: en **Materias**, el panel «Google Classroom» guía los tres pasos — conectar tu cuenta de Google, vincular la materia con un curso y presionar «Sincronizar ahora». Los alumnos se emparejan por **correo** (columna de correo del grupo vs. correo institucional en Classroom); los correos sin coincidencia se reportan al final de cada sincronización.

> ⚠ Con `npm run dev` las funciones de `api/` **no corren** (Vite no las sirve). Para probar la integración localmente usa `npx vercel dev`, con `GOOGLE_REDIRECT_URI=http://localhost:3000/api/classroom/callback` también autorizado en Google Cloud; o prueba directo en el sitio desplegado.

## Estructura

```
api/
  _lib/classroom.js      Utilidades del backend: auth, OAuth de Google, cliente service-role
  classroom/
    auth-url.js          GET — genera la URL de autorización de Google
    callback.js          GET — recibe el redirect de Google y guarda los tokens
    courses.js           GET — lista los cursos donde el docente es profesor
    sync.js              POST — importa tareas y estados de entrega a KardexPro
db/classroom.sql         Migración de la integración (correr en Supabase SQL Editor)
src/
  lib/supabase.js        Cliente Supabase (schema kardex) y constantes de dominio
  lib/api.js             Cliente de las funciones /api (manda el JWT de Supabase)
  context/AuthContext.jsx Sesión, login/registro, errores traducidos al español
  components/             Layout (nav inferior), ProtectedRoute y ClassroomPanel
  pages/
    Login.jsx             Iniciar sesión / crear cuenta
    Home.jsx              Saludo + grupos recientes
    Groups.jsx            Lista y alta de grupos
    GroupDetail.jsx       Alumnos: alta en cadena (con correo), importación .xlsx/.csv, baja lógica
    SubjectConfig.jsx     Materias, componentes por trimestre, actividades y panel de Classroom
    ClassRegister.jsx     Pase de lista con chips por actividad + registro de conducta
    Settings.jsx          Cerrar sesión
scripts/generate-icons.mjs  Regenera los íconos PWA placeholder (npm run icons)
```

## Notas

- Los promedios se leen de la vista `v_student_averages` (ponderación calculada en la base de datos, no en el frontend).
- La suma de porcentajes por materia+trimestre se valida en el cliente **y** en la base de datos (trigger).
- La baja de alumnos es lógica (`active = false`): las calificaciones se conservan y el alumno puede reactivarse.
- Los tokens OAuth de Google viven en `kardex.classroom_tokens` con RLS activo y sin políticas: solo el backend de Vercel (service role) puede leerlos; el navegador jamás los ve.
