import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useSession } from '../lib/session'
import { loadChapters, loadSubjects } from '../lib/data'
import { daysAgo, fmtDay, hourNow, isWeekday, pct, today } from '../lib/dates'
import type { Chapter, Checkin, CheckinItem, Quiz, Review, Subject } from '../lib/types'

const DEADLINE_HOUR = 17

export default function Painel() {
  const { family } = useSession()
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [items, setItems] = useState<CheckinItem[]>([])
  const [reviews, setReviews] = useState<Review[]>([])
  const [quizzes, setQuizzes] = useState<Quiz[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])

  useEffect(() => {
    (async () => {
      const none = ['00000000-0000-0000-0000-000000000000']
      const { data: cks } = await supabase.from('checkins').select('*').gte('day', daysAgo(30)).order('day', { ascending: false })
      const ids = (cks ?? []).map((c) => c.id)
      const { data: its } = await supabase.from('checkin_items').select('*').in('checkin_id', ids.length ? ids : none)
      const itemIds = (its ?? []).map((i) => i.id)
      const [{ data: rv }, { data: qz }, s, c] = await Promise.all([
        supabase.from('reviews').select('*').in('item_id', itemIds.length ? itemIds : none).order('created_at', { ascending: false }),
        supabase.from('quizzes').select('*').order('created_at', { ascending: false }),
        loadSubjects(true), loadChapters(),
      ])
      setCheckins((cks ?? []) as Checkin[]); setItems((its ?? []) as CheckinItem[])
      setReviews((rv ?? []) as Review[]); setQuizzes((qz ?? []) as Quiz[]); setSubjects(s); setChapters(c)
    })()
  }, [])

  const todayCk = checkins.find((c) => c.day === today())
  const late = isWeekday() && hourNow() >= DEADLINE_HOUR && (!todayCk || todayCk.status === 'rascunho')

  // Últimos 10 dias úteis
  const week = useMemo(() => {
    const out: { day: string; ck?: Checkin }[] = []
    for (let i = 0; out.length < 10 && i < 30; i++) {
      const d = daysAgo(i)
      if (isWeekday(d)) out.push({ day: d, ck: checkins.find((c) => c.day === d) })
    }
    return out.reverse()
  }, [checkins])

  const perSubject = useMemo(() => subjects.map((s) => {
    const its = items.filter((i) => i.subject_id === s.id)
    const rvs = reviews.filter((r) => its.some((i) => i.id === r.item_id))
    const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
    const chs = chapters.filter((c) => c.subject_id === s.id)
    const qz = quizzes.filter((q) => chs.some((c) => c.id === q.chapter_id) && q.status === 'corrigida')
    const lastQuiz = qz[0]
    const daysSince = s.last_seen_on ? Math.round((Date.parse(today()) - Date.parse(s.last_seen_on)) / 86400000) : null
    return {
      s, days: its.length, done: avg(rvs.map((r) => r.done_ratio)), correct: avg(rvs.map((r) => r.correct_ratio)),
      returned: rvs.filter((r) => r.verdict === 'devolvido').length,
      current: chs.filter((c) => c.status === 'em_andamento').map((c) => c.title).at(-1),
      mastered: chs.filter((c) => c.status === 'dominado').length,
      lastQuiz, daysSince,
    }
  }), [subjects, items, reviews, chapters, quizzes])

  const notes = reviews.filter((r) => r.note_to_parent).slice(0, 5)
  const pendingQuizzes = quizzes.filter((q) => q.status === 'disponivel')

  return (
    <div className="stack">
      <h2>Painel</h2>

      {late
        ? <p className="banner danger">⚠️ Já passou das {DEADLINE_HOUR}h e o dia de hoje ainda não foi entregue.</p>
        : <p className={'banner ' + (todayCk?.status === 'corrigido' ? 'ok' : 'info')}>
            Hoje: {!todayCk ? 'nada enviado ainda' : todayCk.status === 'rascunho' ? 'começou, ainda não entregou' : todayCk.status === 'corrigido' ? 'entregue e corrigido' : 'entregue, aguardando correção'}
          </p>}

      <div className="card">
        <h3>Entregas (últimos 10 dias úteis)</h3>
        <div className="days">
          {week.map(({ day, ck }) => (
            <div key={day} className={'day ' + (ck && ck.status !== 'rascunho' ? 'ok' : day === today() ? 'wait' : 'miss')} title={fmtDay(day)}>
              <span>{fmtDay(day).slice(0, 3)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Por matéria (30 dias)</h3>
        <div className="table">
          <div className="tr th"><span>Matéria</span><span>Dias</span><span>Feitos</span><span>Acertos</span><span>Provinha</span></div>
          {perSubject.map((r) => (
            <div key={r.s.id} className={'tr' + (r.s.active ? '' : ' inactive')}>
              <span>
                <b>{r.s.name}</b>
                {r.current && <><br /><span className="small muted">{r.current}</span></>}
                {r.daysSince != null && r.daysSince > 10 && r.s.active && <><br /><span className="small danger">sem aparecer há {r.daysSince} dias</span></>}
                {r.returned > 0 && <><br /><span className="small warn">{r.returned} devolvida(s)</span></>}
              </span>
              <span>{r.days}</span>
              <span className={r.done != null && r.done < 0.7 ? 'danger' : ''}>{pct(r.done)}</span>
              <span className={r.correct != null && r.correct < 0.6 ? 'danger' : ''}>{pct(r.correct)}</span>
              <span>{r.lastQuiz ? <span className={'score ' + ((r.lastQuiz.score ?? 0) >= 7 ? 'ok' : 'bad')}>{r.lastQuiz.score?.toFixed(1)}</span> : '–'}{r.mastered ? <span className="small muted"> · {r.mastered}✓</span> : null}</span>
            </div>
          ))}
          {perSubject.length === 0 && <p className="muted small">As matérias aparecem aqui conforme ela for cadastrando.</p>}
        </div>
      </div>

      {pendingQuizzes.length > 0 && (
        <p className="banner warn">{pendingQuizzes.length} provinha(s) esperando ela fazer. <Link to="/provinhas">Ver</Link></p>
      )}

      {notes.length > 0 && (
        <div className="card stack">
          <h3>Observações da correção</h3>
          {notes.map((r) => {
            const it = items.find((i) => i.id === r.item_id)
            const ck = checkins.find((c) => c.id === it?.checkin_id)
            return <p key={r.id} className="small"><b>{subjects.find((s) => s.id === it?.subject_id)?.name}</b> {ck && <span className="muted">({fmtDay(ck.day)})</span>}: {r.note_to_parent}</p>
          })}
        </div>
      )}

      {family && (
        <p className="muted small">Código da família para a conta dela: <b className="code">{family.invite_code}</b></p>
      )}
    </div>
  )
}
