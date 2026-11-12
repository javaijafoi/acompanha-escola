import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSession } from '../lib/session'
import { loadSubjects, uploadToBucket } from '../lib/data'
import { fmtDay } from '../lib/dates'
import type { Book, Slot, Subject, Term, Timetable } from '../lib/types'

const DIAS = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const TT_STATUS: Record<Timetable['status'], string> = {
  aguardando_leitura: 'aguardando leitura', ativa: 'ativa', bloqueada: 'bloqueada: o responsável precisa revisar', substituida: 'antiga',
}
const BOOK_STATUS: Record<Book['status'], string> = { aguardando_leitura: 'aguardando leitura', cadastrado: 'cadastrado', com_problema: 'com problema' }

export default function Configurar() {
  const { profile, family } = useSession()
  const parent = profile?.role === 'parent'
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [tts, setTts] = useState<Timetable[]>([])
  const [slots, setSlots] = useState<Slot[]>([])
  const [books, setBooks] = useState<Book[]>([])
  const [terms, setTerms] = useState<Term[]>([])
  const [notes, setNotes] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  async function reload() {
    const [s, { data: t }, { data: b }, { data: tr }] = await Promise.all([
      loadSubjects(true),
      supabase.from('timetables').select('*').order('created_at', { ascending: false }),
      supabase.from('books').select('*').order('created_at', { ascending: false }),
      supabase.from('terms').select('*').order('starts_on'),
    ])
    setSubjects(s); setTts((t ?? []) as Timetable[]); setBooks((b ?? []) as Book[]); setTerms((tr ?? []) as Term[])
    const active = (t ?? []).find((x) => x.status === 'ativa')
    if (active) {
      const { data: sl } = await supabase.from('timetable_slots').select('*').eq('timetable_id', active.id)
      setSlots((sl ?? []) as Slot[])
    } else setSlots([])
    if (parent) {
      const { data: lp } = await supabase.from('learner_profile').select('notes').maybeSingle()
      setNotes(lp?.notes ?? '')
    }
  }
  useEffect(() => { reload() }, [])

  const name = (id: string) => subjects.find((s) => s.id === id)?.name ?? '?'
  const active = tts.find((t) => t.status === 'ativa')
  const pending = tts.filter((t) => t.status === 'aguardando_leitura' || t.status === 'bloqueada')
  const maxPos = Math.max(0, ...slots.map((s) => s.position))
  const days = [1, 2, 3, 4, 5, 6].filter((d) => d <= 5 || slots.some((s) => s.weekday === d))

  return (
    <div className="stack">
      <h2>Configurar</h2>
      {msg && <p className="note">{msg}</p>}

      <div className="card stack">
        <h3>Grade horária</h3>
        {active ? (
          <div className="grade" style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}>
            {days.map((d) => <b key={d} className="small">{DIAS[d]}</b>)}
            {Array.from({ length: maxPos }, (_, i) => i + 1).flatMap((pos) => days.map((d) => {
              const s = slots.find((x) => x.weekday === d && x.position === pos)
              return <span key={d + '-' + pos} className="small">{s ? name(s.subject_id) : ''}</span>
            }))}
          </div>
        ) : <p className="small muted">Nenhuma grade ativa ainda. Tire foto do quadro de horários abaixo.</p>}
        {pending.map((t) => (
          <p key={t.id} className={'note ' + (t.status === 'bloqueada' ? 'danger' : '')}>
            Grade enviada em {fmtDay(t.created_at.slice(0, 10))}: {TT_STATUS[t.status]}{t.review_note ? ` · ${t.review_note}` : ''}
          </p>
        ))}
        <PhotoForm
          title={active ? 'A grade mudou' : 'Enviar foto da grade'}
          textLabel={active ? 'Por que mudou? (obrigatório)' : undefined}
          onSubmit={async (text, files) => {
            if (active && !text.trim()) throw new Error('Explique por que a grade mudou.')
            const { data: t, error } = await supabase.from('timetables').insert({ family_id: profile!.family_id, child_reason: text.trim() }).select().single()
            if (error) throw error
            for (const f of files) {
              const path = await uploadToBucket(profile!.family_id, 'horarios/' + t.id, f)
              const r = await supabase.from('timetable_photos').insert({ family_id: profile!.family_id, timetable_id: t.id, storage_path: path })
              if (r.error) throw r.error
            }
            setMsg('Grade enviada. A próxima rodada lê e confere.'); reload()
          }} />
      </div>

      <div className="card stack">
        <h3>Livros do trimestre</h3>
        <p className="small muted">Fotografe o sumário de cada livro (as páginas com a lista de capítulos e números de página).</p>
        {books.map((b) => (
          <p key={b.id} className="small"><b>{b.title}</b> · {BOOK_STATUS[b.status]}{b.review_note ? ` · ${b.review_note}` : ''}</p>
        ))}
        <PhotoForm title="Cadastrar livro" textLabel="Nome do livro (ex.: Livro 1 – 1º trimestre)" requireText
          extra={terms.length ? (v, set) => (
            <select value={v} onChange={(e) => set(e.target.value)}>
              <option value="">Trimestre…</option>
              {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>) : undefined}
          onSubmit={async (text, files, extra) => {
            const { data: b, error } = await supabase.from('books').insert({ family_id: profile!.family_id, title: text.trim(), term_id: extra || null }).select().single()
            if (error) throw error
            for (const f of files) {
              const path = await uploadToBucket(profile!.family_id, 'livros/' + b.id, f)
              const r = await supabase.from('book_photos').insert({ family_id: profile!.family_id, book_id: b.id, storage_path: path })
              if (r.error) throw r.error
            }
            setMsg('Livro enviado. A próxima rodada cadastra os capítulos.'); reload()
          }} />
      </div>

      <div className="card stack">
        <h3>Trimestres</h3>
        {terms.map((t) => <p key={t.id} className="small"><b>{t.name}</b>: {fmtDay(t.starts_on)} a {fmtDay(t.ends_on)}</p>)}
        {terms.length === 0 && <p className="small muted">Nenhum trimestre cadastrado.</p>}
        {parent && <TermForm familyId={profile!.family_id} onDone={reload} />}
      </div>

      {parent && (
        <div className="card stack">
          <h3>Perfil de aprendizagem <span className="small muted">(só você vê)</span></h3>
          <p className="small muted">A correção usa isto para ajustar o jeito de explicar. Nunca aparece para ele.</p>
          <textarea rows={7} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button onClick={async () => {
            const { error } = await supabase.from('learner_profile').upsert({ family_id: profile!.family_id, notes, updated_at: new Date().toISOString() })
            setMsg(error ? error.message : 'Perfil salvo.')
          }}>Salvar perfil</button>
        </div>
      )}

      {parent && family && <p className="muted small">Código da família: <b className="code">{family.invite_code}</b></p>}
    </div>
  )
}

function PhotoForm({ title, textLabel, requireText, extra, onSubmit }: {
  title: string; textLabel?: string; requireText?: boolean
  extra?: (v: string, set: (v: string) => void) => JSX.Element
  onSubmit: (text: string, files: File[], extra: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [ex, setEx] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (!open) return <button onClick={() => setOpen(true)}>{title}</button>
  return (
    <div className="stack sub">
      {textLabel && <label>{textLabel}<input value={text} onChange={(e) => setText(e.target.value)} /></label>}
      {extra?.(ex, setEx)}
      <label className="button">📷 Fotos ({files.length})
        <input hidden type="file" accept="image/*" capture="environment" multiple onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
      </label>
      {err && <p className="note danger">{err}</p>}
      <div className="row">
        <button className="primary" disabled={busy} onClick={async () => {
          setErr(null)
          if (requireText && !text.trim()) return setErr('Preencha o nome.')
          if (!files.length) return setErr('Tire pelo menos uma foto.')
          setBusy(true)
          try { await onSubmit(text, files, ex); setOpen(false); setText(''); setFiles([]) } catch (e: any) { setErr(e.message) }
          setBusy(false)
        }}>{busy ? 'Enviando…' : 'Enviar'}</button>
        <button className="link" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </div>
  )
}

function TermForm({ familyId, onDone }: { familyId: string; onDone: () => void }) {
  const [name, setName] = useState('')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="stack sub">
      <div className="row">
        <input placeholder="Ex.: 1º trimestre 2027" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="date" value={a} onChange={(e) => setA(e.target.value)} />
        <input type="date" value={b} onChange={(e) => setB(e.target.value)} />
      </div>
      {err && <p className="note danger">{err}</p>}
      <button onClick={async () => {
        if (!name || !a || !b) return setErr('Preencha nome e datas.')
        const { error } = await supabase.from('terms').insert({ family_id: familyId, name, starts_on: a, ends_on: b })
        if (error) setErr(error.message); else { setName(''); setA(''); setB(''); onDone() }
      }}>Adicionar trimestre</button>
    </div>
  )
}
