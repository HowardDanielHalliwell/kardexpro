-- Migración: integración con Google Classroom + correo de alumnos
-- Ejecutar UNA VEZ en Supabase → SQL Editor (es idempotente: correrla de
-- nuevo no rompe nada).

-- Correo del alumno: se usa para emparejarlo con su cuenta de Classroom
alter table kardex.students
  add column if not exists email text;

-- Vínculo materia ↔ curso de Classroom y fecha de la última sincronización
alter table kardex.subjects
  add column if not exists google_classroom_id text,
  add column if not exists google_classroom_synced_at timestamptz;

-- Las actividades importadas recuerdan de qué tarea de Classroom vienen
alter table kardex.activities
  add column if not exists google_classroom_coursework_id text;

-- Tokens OAuth de Google por docente. SOLO los toca el backend de Vercel con
-- la service role key (que salta RLS): al activar RLS sin crear ninguna
-- política, ni anon ni authenticated pueden leer o escribir esta tabla.
create table if not exists kardex.classroom_tokens (
  teacher_id uuid primary key references auth.users (id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expiry timestamptz,
  scope text,
  created_at timestamptz not null default now()
);

alter table kardex.classroom_tokens enable row level security;

-- El schema kardex es personalizado: la tabla nueva necesita grant explícito
-- para el rol del backend
grant all on kardex.classroom_tokens to service_role;
