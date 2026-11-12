import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadChapters, loadSubjects } from '../lib/data'
import { daysAgo, fmtDay, hourNow, isWeekday, pct, today } from '../lib/dates'
import type { Alert, Chapter, Checkin, CheckinItem, Quiz, Review, Subject, Task, Term } from '../lib/types'

const DEADLINE_HOUR = 17
const NONE = ['00000000-0000-0000-0000-000000000000']

export default function Painel() {
  const [terms, setTerms] = useState<Term[]>([])
  const [range, setRange] = useState<{ from: string; to: string; label: string }>({ from: daysAgo(30), to: today(), label: 'Últimos 30 dias' })
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [items, setItems] = useState<CheckinItem[]>([])
  const [reviews, setReviews] = useState<Review[]>([])
  const [quizzes, setQuizzes] = useState<Quiz[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [showResolved, setShowResolved] = useState(false)

  useEffect(() => { supabase.from('terms').select('*').order('starts_on').then(({ data }) => setTerms((data ?? []) as Term[])) }, [])

  async function load() {
    const { data: cks } = await supabase.from('checkins').select('*').gte('day', range.from).lte('day', range.to).order('day', { ascending: false })
    const ids = (cks ?? []).map((c) => c.id)
    const { data: its } = await supabase.from('checkin_items').select('*').in('checkin_id', ids.length ? ids : NONE)
    const itemIds = (its ?? []).map((i) => i.id)
    const [{ data: rv }, { data: qz }, s, c, { data: al }, { data: tk }] = await Promise.all([
      supabase.from('reviews').select('*').in('item_id', itemIds.length ? itemIds : NONE).order('created_at', { ascending: false }),
      supabase.from('quizzes').select('*').order('created_at', { ascending: false }),
      loadSubjects(true), loadChapters(),
      supabase.from('alerts').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('tasks').select('*').order('created_at', { ascending: false }).limit(200),
    ])
    setCheckins((cks ?? []) as Checkin[]); setItems((its ?? []) as CheckinItem[]); setReviews((rv ?? []) as Review[])
    setQuizzes((qz ?? []) as Quiz[]); setSubjects(s); setChapters(c); setAlerts((al ?? []) as Alert[]); setTasks((tk ?? []) as Task[])
  }
  useEffect(() => { load() }, [range.from, range.to])

  const sname = (id: string | null) => subjects.find((s) => s.id === id)?.name ?? ''
  const todayCk = checkins.find((c) => c.day === today())
  const late = isWeekday() && hourNow() >= DEADLINE_HOUR && (!todayCk || todayCk.status === 'rascunho')
  const openAlerts = alerts.filter((a) => a.status === 'aberto')
  const pendingTasks = tasks.filter((t) => t.status === 'pendente')
  const inRange = (iso: string) => iso.slice(0, 10) >= range.from && iso.slice(0, 10) <= range.to

  const week = useMemo(() => {
    const out: { day: string; ck?: Checkin }[] = []
    for (let i = 0; out.length < 10 && i < 30; i++) {
      const d = daysAgo(i)
      if (isWeekday(d)) out.push({ day: d, ck: checkins.find((c) => c.day === d) })
    }
    return out.reverse()
  }, [checkins])

  const perSubject = useMemo(() => subjects.filter((s) => s.active).map((s) => {
    const its = items.filter((i) => i.subject_id === s.id)
    const rvs = reviews.filter((r) => its.some((i) => i.id === r.item_id))
    const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
    const chs = chapters.filter((c) => c.subject_id === s.id)
    const qz = quizzes.filter((q) => q.status === 'corrigida' && (q.subject_id === s.id || chs.some((c) => c.id === q.chapter_id)) && q.graded_at && inRange(q.graded_at))
    const daysSince = s.last_seen_on ? Math.round((Date.parse(today()) - Date.parse(s.last_seen_on)) / 86400000) : null
    return {
      s, days: its.filter((i) => !i.no_class_reason).length, noClass: its.filter((i) => i.no_class_reason).length,
      pages: its.reduce((n, i) => n + (i.page_from != null && i.page_to != null ? i.page_to - i.page_from + 1 : 0), 0),
      done: avg(rvs.map((r) => r.done_ratio)), correct: avg(rvs.map((r) => r.correct_ratio)),
      returned: rvs.filter((r) => r.verdict === 'devolvido').length,
      quizAvg: avg(qz.map((q) => q.score)), quizN: qz.length,
      current: chs.filter((c) => c.status === 'em_andamento').sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]?.title,
      mastered: chs.filter((c) => c.status === 'dominado').length, total: chs.length,
      daysSince,
    }
  }), [subjects, items, reviews, chapters, quizzes, range])

  async function resolve(a: Alert) {
    await supabase.from('alerts').update({ status: 'resolvido', resolved_at: new Date().toISOString() }).eq('id', a.id)
    load()
  }
  async function cancelTask(t: Task) {
    if (!confirm(`Cancelar a tarefa "${t.title}"?`)) return
    await supabase.from('tasks').update({ status: 'cancelada', done_at: new Date().toISOString() }).eq('id', t.id)
    load()
  }

  // Diário: um resumo por dia (o que estudou, como foi)
  const diary = checkins.slice(0, 15).map((c) => {
    const its = items.filter((i) => i.checkin_id === c.id)
    return { c, its, rvs: reviews.filter((r) => its.some((i) => i.id === r.item_id)) }
  })

  return (
    <div className="stack">
      <div className="row between">
        <h2>Painel</h2>
        <select className="small" value={range.label} onChange={(e) => {
          const t = terms.find((x) => x.name === e.target.value)
          setRange(t ? { from: t.starts_on, to: t.ends_on, label: t.name } : { from: daysAgo(30), to: today(), label: 'Últimos 30 dias' })
        }}>
          <option>Últimos 30 dias</option>
          {terms.map((t) => <option key={t.id}>{t.name}</option>)}
        </select>
      </div>

      {late
        ? <p className="banner danger">⚠️ Já passou das {DEADLINE_HOUR}h e o dia de hoje ainda não foi entregue.</p>
        : <p className={'banner ' + (todayCk?.status === 'corrigido' ? 'ok' : 'info')}>
            Hoje: {!todayCk ? 'nada enviado ainda' : todayCk.status === 'rascunho' ? 'começou, ainda não entregou' : todayCk.status === 'corrigido' ? 'entregue e corrigido' : 'entregue, aguardando correção'}
          </p>}

      <div className="card stack">
        <div className="row between">
          <h3>Alertas {openAlerts.length > 0 && <span className="score bad">{openAlerts.length}</span>}</h3>
          <button className="link small" onClick={() => setShowResolved(!showResolved)}>{showResolved ? 'Só abertos' : 'Ver resolvidos'}</button>
        </div>
        {(showResolved ? alerts : openAlerts).map((a) => (
          <div key={a.id} className={'alert ' + a.severity + (a.status === 'resolvido' ? ' inactive' : '')}>
            <div className="row between">
              <b>{a.title}</b>
              {a.status === 'aberto' && <button className="small" onClick={() => resolve(a)}>Resolvido</button>}
            </div>
            <p className="small">{sname(a.subject_id) && <>{sname(a.subject_id)} · </>}{fmtDay(a.created_at.slice(0, 10))}</p>
            {a.details && <p className="small">{a.details}</p>}
          </div>
        ))}
        {openAlerts.length === 0 && !showResolved && <p className="small muted">Nenhum alerta aberto.</p>}
      </div>

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
        <h3>Por matéria · {range.label}</h3>
        <div className="table">
          <div className="tr th"><span>Matéria</span><span>Dias/págs</span><span>Feitos</span><span>Acertos</span><span>Provinhas</span></div>
          {perSubject.map((r) => (
            <div key={r.s.id} className="tr">
              <span>
                <b>{r.s.name}</b>
                {r.current && <><br /><span className="small muted">{r.current}</span></>}
                {r.total > 0 && <><br /><span className="small muted">{r.mastered}/{r.total} capítulos dominados</span></>}
                {r.daysSince != null && r.daysSince > 10 && <><br /><span className="small danger">sem aparecer há {r.daysSince} dias</span></>}
                {r.returned > 0 && <><br /><span className="small warn">{r.returned} devolvida(s)</span></>}
                {r.noClass > 0 && <><br /><span className="small muted">{r.noClass} dia(s) sem conteúdo</span></>}
              </span>
              <span>{r.days}<br /><span className="small muted">{r.pages} p.</span></span>
              <span className={r.done != null && r.done < 0.7 ? 'danger' : ''}>{pct(r.done)}</span>
              <span className={r.correct != null && r.correct < 0.6 ? 'danger' : ''}>{pct(r.correct)}</span>
              <span>{r.quizAvg != null ? <span className={'score ' + (r.quizAvg >= 7 ? 'ok' : 'bad')}>{r.quizAvg.toFixed(1)}</span> : '–'}{r.quizN ? <span className="small muted"> ({r.quizN})</span> : null}</span>
            </div>
          ))}
          {perSubject.length === 0 && <p className="muted small">As matérias aparecem aqui conforme a grade e o diário forem sendo preenchidos.</p>}
        </div>
      </div>

      <div className="card stack">
        <h3>Pendências dele ({pendingTasks.length})</h3>
        {pendingTasks.map((t) => (
          <div key={t.id} className="row between sub">
            <span><b>{t.title}</b>{t.due_on && <span className={'small ' + (t.due_on < today() ? 'danger' : 'muted')}> · até {fmtDay(t.due_on)}</span>}</span>
            <button className="link small" onClick={() => cancelTask(t)}>Cancelar</button>
          </div>
        ))}
        {pendingTasks.length === 0 && <p className="small muted">Nada pendente.</p>}
        {quizzes.some((q) => q.status === 'disponivel') && <Link to="/provinhas" className="small">Ver provinhas e revisões →</Link>}
      </div>

      <div className="card stack">
        <h3>Diário</h3>
        {diary.map(({ c, its, rvs }) => (
          <div key={c.id} className="sub">
            <b>{fmtDay(c.day)}</b> <span className={'status ' + c.status}>{c.status}</span>
            {its.map((i) => {
              const r = rvs.find((x) => x.item_id === i.id)
              return (
                <p key={i.id} className="small">
                  <b>{sname(i.subject_id)}</b>{' '}
                  {i.no_class_reason ? <span className="muted">sem conteúdo: {i.no_class_reason}</span> : <>
                    {i.page_from != null && <span className="muted">págs. {i.page_from}–{i.page_to} · </span>}
                    {r ? <>{r.verdict === 'devolvido' ? '❌ devolvida' : '✅'} feitos {pct(r.done_ratio)}, acertos {pct(r.correct_ratio)}{r.topics.length ? ` · ${r.topics.slice(0, 3).join(', ')}` : ''}</> : <span className="muted">{i.learned}</span>}
                  </>}
                </p>
              )
            })}
          </div>
        ))}
        {diary.length === 0 && <p className="small muted">Nenhum dia registrado nesse período.</p>}
        <Link to="/historico" className="small">Ver tudo, com fotos →</Link>
      </div>
    </div>
  )
}
