import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSession } from '../lib/session'
import { loadChapters, loadSubjects } from '../lib/data'
import { fmtDay } from '../lib/dates'
import type { Chapter, Subject } from '../lib/types'

const STATUS: Record<Chapter['status'], string> = { em_andamento: 'em andamento', finalizado: 'aguardando provinha', dominado: 'dominado ✓' }

export default function Materias() {
  const { profile } = useSession()
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const reload = async () => { setSubjects(await loadSubjects(true)); setChapters(await loadChapters()) }
  useEffect(() => { reload() }, [])

  async function finish(c: Chapter) {
    if (!confirm(`Terminou "${c.title}"? Vai chegar uma provinha de revisão.`)) return
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
      <p className="muted small">As matérias e capítulos são criados quando ela faz o diário. Aqui dá pra marcar um capítulo como terminado.</p>
      {subjects.map((s) => (
        <div key={s.id} className={'card stack' + (s.active ? '' : ' inactive')}>
          <div className="row between">
            <strong>{s.name}</strong>
            <span className="small muted">{s.last_seen_on ? 'última vez ' + fmtDay(s.last_seen_on) : 'sem registros'}</span>
          </div>
          {chapters.filter((c) => c.subject_id === s.id).map((c) => (
            <div key={c.id} className="row between sub">
              <span>{c.title} <span className="small muted">· {STATUS[c.status]}</span></span>
              {c.status === 'em_andamento' && <button className="small" onClick={() => finish(c)}>Terminei</button>}
            </div>
          ))}
          {profile?.role === 'parent' && (
            <button className="link small" onClick={() => toggle(s)}>{s.active ? 'Arquivar matéria' : 'Reativar matéria'}</button>
          )}
        </div>
      ))}
    </div>
  )
}
