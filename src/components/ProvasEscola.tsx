import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import { supabase } from '../lib/supabase'
import { useSession } from '../lib/session'
import { uploadToBucket } from '../lib/data'
import { fmtDay, today } from '../lib/dates'
import type { Chapter, Exam, Photo, Subject } from '../lib/types'
import Photos from './Photos'
import { CopyPrompt } from '../pages/Provinhas'

const LABEL: Record<string, string> = { certo: '✅', errado: '❌', parcial: '🟡', em_branco: '⬜' }

// Provas da escola: opcionais. O aluno fotografa, a correção explica cada questão e monta uma revisão.
export default function ProvasEscola({ subjects, chapters }: { subjects: Subject[]; chapters: Chapter[] }) {
  const { profile } = useSession()
  const [exams, setExams] = useState<Exam[]>([])
  const [photos, setPhotos] = useState<(Photo & { exam_id: string })[]>([])
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  async function reload() {
    const [{ data: ex }, { data: ph }] = await Promise.all([
      supabase.from('exams').select('*').order('created_at', { ascending: false }),
      supabase.from('exam_photos').select('*').order('created_at'),
    ])
    setExams((ex ?? []) as Exam[]); setPhotos(((ph ?? []) as any[]).map((p) => ({ ...p, item_id: '', page_number: null, version: 1 })))
  }
  useEffect(() => { reload() }, [])
  const name = (id: string | null) => subjects.find((s) => s.id === id)?.name ?? ''

  return (
    <div className="stack">
      <div className="row between">
        <h2>Provas da escola</h2>
        {!adding && <button onClick={() => setAdding(true)}>+ Mandar prova</button>}
      </div>
      <p className="small muted">Mande as fotos de uma prova corrigida pelo professor. Eu explico cada questão e faço uma revisão.</p>
      {adding && <NovaProva subjects={subjects} chapters={chapters} familyId={profile!.family_id}
        onDone={() => { setAdding(false); reload() }} onCancel={() => setAdding(false)} />}
      {exams.length === 0 && !adding && <p className="small muted">Nenhuma prova ainda.</p>}
      {exams.map((e) => (
        <div key={e.id} className="card stack">
          <button className="row between plain" onClick={() => setOpen(open === e.id ? null : e.id)}>
            <strong>{name(e.subject_id)}{e.title ? ` · ${e.title}` : ''}</strong>
            <span className="small">{e.taken_on ? fmtDay(e.taken_on) + ' · ' : ''}
              {e.status === 'aguardando_leitura' ? <span className="muted">esperando a correção</span>
                : e.status === 'com_problema' ? <span className="warn">não deu para ler</span>
                : <b>{e.grade_text || 'explicada'}</b>}
            </span>
          </button>
          {open === e.id && (<>
            <Photos photos={photos.filter((p) => p.exam_id === e.id)} />
            {e.summary && <p>{e.summary}</p>}
            {e.questions.length > 0 && (
              <ul className="exercises">
                {e.questions.map((q, i) => <li key={i}><b>{q.ref}</b> {LABEL[q.status] ?? q.status}{q.comment ? <> · {q.comment}</> : null}</li>)}
              </ul>
            )}
            {e.explanation && <div className="sheet"><Markdown>{e.explanation}</Markdown></div>}
            {e.revision_sheet && <details><summary>Folhinha de revisão</summary><div className="sheet"><Markdown>{e.revision_sheet}</Markdown></div></details>}
            {e.ai_prompt && <CopyPrompt text={e.ai_prompt} />}
          </>)}
        </div>
      ))}
    </div>
  )
}

function NovaProva({ subjects, chapters, familyId, onDone, onCancel }: {
  subjects: Subject[]; chapters: Chapter[]; familyId: string; onDone: () => void; onCancel: () => void
}) {
  const [subjectId, setSubjectId] = useState('')
  const [chapterId, setChapterId] = useState('')
  const [title, setTitle] = useState('')
  const [day, setDay] = useState(today())
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (!subjectId) return setErr('Escolha a matéria.')
    if (!files.length) return setErr('Tire uma foto de cada página da prova.')
    setBusy(true); setErr(null)
    try {
      const { data: ex, error } = await supabase.from('exams').insert({ family_id: familyId, subject_id: subjectId,
        chapter_id: chapterId || null, title: title.trim(), taken_on: day || null, note: note.trim() }).select().single()
      if (error) throw error
      let i = 1
      for (const f of files) {
        const path = await uploadToBucket(familyId, 'provas/' + ex.id, f)
        const r = await supabase.from('exam_photos').insert({ family_id: familyId, exam_id: ex.id, storage_path: path, sort: i++ })
        if (r.error) throw r.error
      }
      onDone()
    } catch (e: any) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div className="card stack">
      <label>Matéria
        <select value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setChapterId('') }}>
          <option value="">Escolha…</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      {subjectId && (
        <label>Capítulo <span className="muted small">(se souber)</span>
          <select value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
            <option value="">Não sei / vários</option>
            {chapters.filter((c) => c.subject_id === subjectId).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
      )}
      <label>Nome da prova <span className="muted small">(opcional)</span><input placeholder="Ex.: Prova 1 do 3º trimestre" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>Data da prova<input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
      <label>Recado <span className="muted small">(opcional)</span><input placeholder="Ex.: não entendi a questão 4" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <label className="button">📷 Fotos da prova ({files.length})
        <input hidden type="file" accept="image/*" capture="environment" multiple onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
      </label>
      <p className="small muted">Uma foto por página, com a correção do professor aparecendo.</p>
      {err && <p className="note danger">{err}</p>}
      <div className="row">
        <button className="primary" disabled={busy} onClick={save}>{busy ? 'Enviando…' : 'Mandar prova'}</button>
        <button className="link" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  )
}
