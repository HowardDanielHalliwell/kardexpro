import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const HEADER_WORDS = /^(no\.?|núm\.?|numero|número|lista|#|nombre(s)?|alumno(s)?|apellido(s)?|estudiante(s)?|nombre completo)$/i

// Convierte las filas crudas de la hoja en { list_number?, full_name }
function parseSheetRows(rows) {
  const parsed = []
  for (const row of rows) {
    const cells = (row ?? []).map((c) => (c == null ? '' : String(c).trim())).filter((c) => c !== '')
    if (cells.length === 0) continue

    let listNumber = null
    let nameParts = []
    for (const cell of cells) {
      const asNumber = Number(cell)
      if (listNumber === null && Number.isInteger(asNumber) && asNumber > 0 && asNumber < 500 && cell.length <= 4) {
        listNumber = asNumber
      } else if (Number.isNaN(asNumber)) {
        nameParts.push(cell)
      }
    }
    const fullName = nameParts.join(' ').replace(/\s+/g, ' ').trim()
    if (!fullName) continue
    // Descarta filas de encabezado ("No.", "Nombre del alumno", etc.)
    if (nameParts.every((p) => HEADER_WORDS.test(p))) continue
    parsed.push({ list_number: listNumber, full_name: fullName })
  }
  return parsed
}

export default function GroupDetail() {
  const { groupId } = useParams()
  const [group, setGroup] = useState(null)
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  // Alta manual en cadena
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const nameInputRef = useRef(null)

  // Importación
  const fileInputRef = useRef(null)
  const [preview, setPreview] = useState(null) // [{list_number, full_name}]
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [{ data: g, error: gErr }, { data: s, error: sErr }] = await Promise.all([
        supabase.from('groups').select('*').eq('id', groupId).maybeSingle(),
        supabase.from('students').select('*').eq('group_id', groupId).order('list_number'),
      ])
      if (cancelled) return
      if (gErr || sErr) setError('No se pudo cargar el grupo: ' + (gErr?.message || sErr?.message))
      setGroup(g)
      setStudents(s ?? [])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [groupId])

  const activeStudents = students.filter((s) => s.active !== false)
  const inactiveStudents = students.filter((s) => s.active === false)
  const nextListNumber = () =>
    students.reduce((max, s) => Math.max(max, s.list_number ?? 0), 0) + 1

  async function handleAdd(e) {
    e.preventDefault()
    const fullName = newName.replace(/\s+/g, ' ').trim()
    if (!fullName) return
    setAdding(true)
    setError('')
    const { data, error: err } = await supabase
      .from('students')
      .insert({ group_id: groupId, list_number: nextListNumber(), full_name: fullName, active: true })
      .select()
      .single()
    setAdding(false)
    if (err) {
      setError('No se pudo agregar al alumno: ' + err.message)
      return
    }
    setStudents((prev) => [...prev, data].sort((a, b) => (a.list_number ?? 0) - (b.list_number ?? 0)))
    setNewName('')
    nameInputRef.current?.focus() // alta en cadena: listo para el siguiente
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir el mismo archivo
    if (!file) return
    setError('')
    try {
      // SheetJS se carga bajo demanda para no inflar el bundle inicial
      const XLSX = await import('xlsx')
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer)
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false })
      const parsed = parseSheetRows(rows)
      if (parsed.length === 0) {
        setError('No se encontraron alumnos en el archivo. Verifica que tenga una columna con nombres.')
        return
      }
      // Completa números de lista faltantes de forma consecutiva
      let next = nextListNumber()
      const used = new Set(students.map((s) => s.list_number))
      for (const row of parsed) {
        if (row.list_number == null || used.has(row.list_number)) {
          while (used.has(next)) next++
          row.list_number = next
        }
        used.add(row.list_number)
        next = Math.max(next, row.list_number) + 1
      }
      setPreview(parsed)
    } catch (err) {
      setError('No se pudo leer el archivo: ' + err.message)
    }
  }

  async function confirmImport() {
    if (!preview?.length) return
    setImporting(true)
    setError('')
    const { data, error: err } = await supabase
      .from('students')
      .insert(preview.map((r) => ({ group_id: groupId, list_number: r.list_number, full_name: r.full_name, active: true })))
      .select()
    setImporting(false)
    if (err) {
      setError('No se pudieron importar los alumnos: ' + err.message)
      return
    }
    setStudents((prev) => [...prev, ...(data ?? [])].sort((a, b) => (a.list_number ?? 0) - (b.list_number ?? 0)))
    setPreview(null)
  }

  async function deactivate(student) {
    if (!window.confirm(`¿Dar de baja a ${student.full_name}? Sus calificaciones se conservan.`)) return
    // Optimista: se refleja de inmediato
    setStudents((prev) => prev.map((s) => (s.id === student.id ? { ...s, active: false } : s)))
    const { error: err } = await supabase.from('students').update({ active: false }).eq('id', student.id)
    if (err) {
      setStudents((prev) => prev.map((s) => (s.id === student.id ? { ...s, active: true } : s)))
      setError('No se pudo dar de baja: ' + err.message)
    }
  }

  async function reactivate(student) {
    setStudents((prev) => prev.map((s) => (s.id === student.id ? { ...s, active: true } : s)))
    const { error: err } = await supabase.from('students').update({ active: true }).eq('id', student.id)
    if (err) {
      setStudents((prev) => prev.map((s) => (s.id === student.id ? { ...s, active: false } : s)))
      setError('No se pudo reactivar: ' + err.message)
    }
  }

  if (loading) return <div className="center"><span className="spinner" /></div>

  if (!group) {
    return (
      <div className="card empty-state">
        <span className="icon" aria-hidden="true">🔎</span>
        Grupo no encontrado.
        <div style={{ marginTop: 12 }}>
          <Link className="btn btn-ghost" to="/grupos">← Volver a grupos</Link>
        </div>
      </div>
    )
  }

  return (
    <>
      <Link to="/grupos" className="muted" style={{ fontWeight: 700 }}>← Grupos</Link>
      <h1 className="page-title" style={{ marginTop: 6 }}>
        {group.name} <span className="muted" style={{ fontSize: '0.9rem' }}>· Ciclo {group.school_year}</span>
      </h1>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Alta manual en cadena */}
      <form className="card" onSubmit={handleAdd}>
        <h2>Agregar alumno</h2>
        <div className="row">
          <span className="list-number" title="Número de lista">{nextListNumber()}</span>
          <input
            ref={nameInputRef}
            className="input grow"
            placeholder="Nombre completo del alumno"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            enterKeyHint="next"
          />
          <button className="btn btn-orange" type="submit" disabled={adding || !newName.trim()}>
            ＋
          </button>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Presiona Enter para agregar y seguir con el siguiente alumno.
        </p>
      </form>

      {/* Importación masiva */}
      <div className="card">
        <h2>Importar lista desde Excel/CSV</h2>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          style={{ display: 'none' }}
          onChange={handleFile}
        />
        <button className="btn btn-ghost btn-block" type="button" onClick={() => fileInputRef.current?.click()}>
          📄 Elegir archivo (.xlsx / .csv)
        </button>
        <p className="muted" style={{ marginTop: 8 }}>
          El archivo puede tener columnas de número de lista y nombre. Verás una vista previa antes de confirmar.
        </p>
      </div>

      {/* Lista de alumnos */}
      <div className="card">
        <h2>Alumnos activos ({activeStudents.length})</h2>
        {activeStudents.length === 0 ? (
          <div className="empty-state">
            <span className="icon" aria-hidden="true">🧑‍🎓</span>
            Sin alumnos todavía. Agrégalos arriba o importa tu lista.
          </div>
        ) : (
          activeStudents.map((s) => (
            <div key={s.id} className="list-item">
              <span className="list-number">{s.list_number}</span>
              <span className="student-name">{s.full_name}</span>
              <button
                className="icon-btn"
                title={`Dar de baja a ${s.full_name}`}
                aria-label={`Dar de baja a ${s.full_name}`}
                onClick={() => deactivate(s)}
              >
                🗑️
              </button>
            </div>
          ))
        )}
      </div>

      {inactiveStudents.length > 0 && (
        <div className="card">
          <button
            className="btn btn-ghost btn-block btn-sm"
            type="button"
            onClick={() => setShowInactive((v) => !v)}
          >
            {showInactive ? 'Ocultar' : 'Mostrar'} bajas ({inactiveStudents.length})
          </button>
          {showInactive &&
            inactiveStudents.map((s) => (
              <div key={s.id} className="list-item student-inactive">
                <span className="list-number" style={{ background: 'var(--muted)' }}>{s.list_number}</span>
                <span className="student-name">{s.full_name}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => reactivate(s)}>
                  Reactivar
                </button>
              </div>
            ))}
        </div>
      )}

      {/* Modal de preview de importación */}
      {preview && (
        <div className="modal-backdrop" onClick={() => !importing && setPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Vista previa · {preview.length} alumno{preview.length !== 1 ? 's' : ''}</h3>
            <p className="muted" style={{ marginBottom: 10 }}>
              Revisa la lista. Puedes quitar filas incorrectas antes de confirmar.
            </p>
            <div style={{ overflowX: 'auto', maxHeight: '46dvh', overflowY: 'auto' }}>
              <table className="preview-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Nombre completo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i}>
                      <td>{r.list_number}</td>
                      <td>{r.full_name}</td>
                      <td>
                        <button
                          className="remove-row"
                          aria-label={`Quitar a ${r.full_name}`}
                          onClick={() => setPreview((p) => p.filter((_, j) => j !== i))}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn-ghost grow" onClick={() => setPreview(null)} disabled={importing}>
                Cancelar
              </button>
              <button className="btn btn-orange grow" onClick={confirmImport} disabled={importing || preview.length === 0}>
                {importing ? 'Importando…' : `Importar ${preview.length}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
