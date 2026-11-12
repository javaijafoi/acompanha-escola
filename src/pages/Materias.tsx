import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import { supabase } from '../lib/supabase'
import { useSession } from '../lib/session'
import { loadChapters, loadSubjects } from '../lib/data'
import { fmtDay } from '../lib/dates'
import type { Book, Chapter, Subject } from '../lib/types'
import { CopyPrompt } from './Provinhas'

const STATUS: Record<Chapter['status'], string> = { em_andamento: 'em andamento', finalizado: 'aguardando provinha', dominado: 'dominado ✓' }

export default function Materias() {
  const { profile } = useSession()
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [books, setBooks] = useState<Book[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const reload = async () => {
    const [s, c, { data: b }] = await Promise.all([loadSubjects(true), loadChapters(), supabase.from('books').select('*')])
    setSubjects(s); setChapters(c); setBooks((b ?? []) as Book[])
  }
  useEffect(() => { reload() }, [])
  const parent = profile?.role === 'parent'

  async function finish(c: Chapter) {
    if (!confirm(`Marcar "${c.title}" como terminado? A próxima rodada gera a provinha.`)) return
    await supabase.from('chapters').update({ status: 'finalizado', finished_at: new Date().toISOString() }).eq('id', c.id)
    reload()
  }
  async function toggle(s: Subject) {
    await supabase.from('subjects').update({ active: !s.active }).eq('id', s.id)
    reload()
  }

  return (
    <div className="stack">
      <h2>Matérias</h2>
      <p className="muted small">Os capítulos vêm do sumário dos livros. Quando todas as páginas de um capítulo chegam, ele fecha sozinho e vem a provinha.</p>
      {subjects.map((s) => (
        <div key={s.id} className={'card stack' + (s.active ? '' : ' inactive')}>
          <div className="row between">
            <strong>{s.name}</strong>
            <span className="small muted">{s.last_seen_on ? 'última vez ' + fmtDay(s.last_seen_on) : 'sem registros'}</span>
          </div>
          {chapters.filter((c) => c.subject_id === s.id).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((c) => (
            <div key={c.id} className="sub stack tight">
              <div className="row between">
                <button className="plain left" onClick={() => setOpen(open === c.id ? null : c.id)}>
                  {c.title} <span className="small muted">
                    {c.start_page ? `· págs. ${c.start_page}–${c.end_page} ` : ''}{books.find((b) => b.id === c.book_id) ? `· ${books.find((b) => b.id === c.book_id)!.title} ` : ''}· {STATUS[c.status]}
                  </span>
                </button>
                {parent && c.status === 'em_andamento' && <button className="small" onClick={() => finish(c)}>Encerrar</button>}
              </div>
              {open === c.id && (<>
                {c.summary_sheet ? <div className="sheet"><Markdown>{c.summary_sheet}</Markdown></div> : <p className="small muted">A revisão do capítulo aparece aqui quando ele terminar.</p>}
                {c.ai_prompt && <CopyPrompt text={c.ai_prompt} />}
              </>)}
            </div>
          ))}
          {parent && (
            <button className="link small" onClick={() => toggle(s)}>{s.active ? 'Arquivar matéria' : 'Reativar matéria'}</button>
          )}
        </div>
      ))}
    </div>
  )
}
