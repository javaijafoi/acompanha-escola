import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import { supabase } from '../lib/supabase'
import { useSession } from '../lib/session'
import { loadChapters, loadSubjects } from '../lib/data'
import { fmtDay, pct } from '../lib/dates'
import type { Book, Chapter, CheckinItem, Review, ReviewVersion, Subject } from '../lib/types'
import { CopyPrompt } from './Provinhas'

const STATUS: Record<Chapter['status'], string> = { em_andamento: 'em andamento', finalizado: 'aguardando provinha', dominado: 'dominado ✓' }

export default function Materias() {
  const { profile } = useSession()
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [books, setBooks] = useState<Book[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const reload = async () => {
    const [s, c, { data: b }, { data: its }, { data: rv }, { data: rh }] = await Promise.all([
      loadSubjects(true), loadChapters(), supabase.from('books').select('*'),
      supabase.from('checkin_items').select('*, checkins!inner(day)').is('no_class_reason', null),
      supabase.from('reviews').select('*'),
      supabase.from('review_history').select('*').order('version'),
    ])
    setSubjects(s); setChapters(c); setBooks((b ?? []) as Book[])
    setEntries(((its ?? []) as (CheckinItem & { checkins: { day: string } })[]).map((i) => ({
      item: i, day: i.checkins.day,
      review: ((rv ?? []) as Review[]).find((r) => r.item_id === i.id) ?? null,
      history: ((rh ?? []) as ReviewVersion[]).filter((h) => h.item_id === i.id),
    })))
  }
  useEffect(() => { reload() }, [])
  const parent = profile?.role === 'parent'

  async function finish(c: Chapter) {
    if (!confirm(`Marcar "${c.title}" como terminado? A próxima rodada gera a provinha.`)) return
    await supabase.from('chapters').update({ status: 'finalizado', finished_at: new Date().toISOString() }).eq('id', c.id)
    reload()
  }
  async function toggleRequired(s: Subject) {
    await supabase.from('subjects').update({ required: !s.required }).eq('id', s.id)
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
            <strong>{s.name} {s.required ? <span className="chip">obrigatória</span> : <span className="small muted">opcional</span>}</strong>
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
                <Entregas list={entries.filter((e) => e.item.chapter_id === c.id)} chapter={c} />
                {c.summary_sheet ? <div className="sheet"><Markdown>{c.summary_sheet}</Markdown></div> : <p className="small muted">A revisão do capítulo aparece aqui quando ele terminar.</p>}
                {c.ai_prompt && <CopyPrompt text={c.ai_prompt} />}
              </>)}
            </div>
          ))}
          {entries.some((e) => e.item.subject_id === s.id && !e.item.chapter_id) && (
            <div className="sub stack tight">
              <button className="plain left" onClick={() => setOpen(open === 'sem-' + s.id ? null : 'sem-' + s.id)}>
                Sem capítulo <span className="small muted">· {entries.filter((e) => e.item.subject_id === s.id && !e.item.chapter_id).length} entrega(s)</span>
              </button>
              {open === 'sem-' + s.id && <Entregas list={entries.filter((e) => e.item.subject_id === s.id && !e.item.chapter_id)} />}
            </div>
          )}
          {parent && (
            <div className="row">
              <button className="link small" onClick={() => toggleRequired(s)}>{s.required ? 'Tornar opcional' : 'Tornar obrigatória'}</button>
              <button className="link small" onClick={() => toggle(s)}>{s.active ? 'Arquivar matéria' : 'Reativar matéria'}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

interface Entry { item: CheckinItem; day: string; review: Review | null; history: ReviewVersion[] }

// Entregas do capítulo em ordem de página, cada uma com as versões que já teve
function Entregas({ list, chapter }: { list: Entry[]; chapter?: Chapter }) {
  if (!list.length) return <p className="small muted">Nenhuma página entregue ainda.</p>
  const sorted = [...list].sort((a, b) => (a.item.page_from ?? 0) - (b.item.page_from ?? 0) || a.day.localeCompare(b.day))
  const pages = new Set<number>()
  for (const e of list) if (e.item.review_status === 'aceito' && e.item.page_from != null)
    for (let p = e.item.page_from; p <= (e.item.page_to ?? e.item.page_from); p++) pages.add(p)
  const total = chapter?.start_page && chapter?.end_page ? chapter.end_page - chapter.start_page + 1 : null
  return (
    <div className="stack tight">
      {total && <p className="small">Páginas aceitas: <b>{[...pages].filter((p) => p >= chapter!.start_page! && p <= chapter!.end_page!).length} de {total}</b></p>}
      {sorted.map((e) => {
        const versions = [
          ...e.history.map((h) => ({ v: h.version, verdict: h.verdict, when: h.reviewed_at, todo: h.todo, correct: h.correct_ratio })),
          ...(e.review ? [{ v: e.review.version, verdict: e.review.verdict, when: e.review.created_at, todo: e.review.todo, correct: e.review.correct_ratio }] : []),
        ]
        const waiting = e.item.review_status === 'pendente'
        return (
          <details key={e.item.id} className="sub">
            <summary>
              <b>{e.item.page_from != null ? `págs. ${e.item.page_from}–${e.item.page_to}` : 'sem páginas'}</b>
              <span className="small muted"> · {fmtDay(e.day)} · </span>
              <span className={'small ' + (e.item.review_status === 'aceito' ? 'ok' : e.item.review_status === 'devolvido' ? 'warn' : 'muted')}>
                {e.item.review_status === 'aceito' ? '✅ aceita' : e.item.review_status === 'devolvido' ? '↩ falta completar' : 'aguardando correção'}
              </span>
              {e.item.version > 1 && <span className="small muted"> · {e.item.version} versões</span>}
            </summary>
            <ul className="versions">
              {versions.map((x) => (
                <li key={x.v}>
                  <b>v{x.v}</b> {fmtDay(x.when.slice(0, 10))} · {x.verdict === 'aceito' ? `aceita, acertos ${pct(x.correct)}` : 'devolvida'}
                  {x.verdict === 'devolvido' && x.todo?.length > 0 && <span className="muted"> · {x.todo.join('; ')}</span>}
                </li>
              ))}
              {waiting && <li><b>v{e.item.version}</b> enviada, aguardando correção</li>}
            </ul>
          </details>
        )
      })}
    </div>
  )
}
