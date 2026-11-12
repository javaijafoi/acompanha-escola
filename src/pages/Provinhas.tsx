import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSession } from '../lib/session'
import { copyText, loadChapters, loadSubjects, uploadToBucket } from '../lib/data'
import { fmtDay } from '../lib/dates'
import type { Chapter, Quiz, Subject } from '../lib/types'
import ProvasEscola from '../components/ProvasEscola'
import Photos from '../components/Photos'
import type { Photo } from '../lib/types'

export default function Provinhas() {
  const { profile } = useSession()
  const [quizzes, setQuizzes] = useState<Quiz[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [openId, setOpenId] = useState<string | null>(null)

  async function reload() {
    const [{ data }, c, s] = await Promise.all([
      supabase.from('quizzes').select('*').order('created_at', { ascending: false }),
      loadChapters(), loadSubjects(true),
    ])
    setQuizzes((data ?? []) as Quiz[]); setChapters(c); setSubjects(s)
  }
  useEffect(() => { reload() }, [])

  const label = (q: Quiz) => {
    const ch = chapters.find((c) => c.id === q.chapter_id)
    const sub = subjects.find((s) => s.id === (q.subject_id ?? ch?.subject_id))
    if (q.kind === 'bloco') return `${sub?.name ?? ''} · revisão: ${q.title || ch?.title || ''}`
    const n = quizzes.filter((x) => x.kind === 'capitulo' && x.chapter_id === q.chapter_id && x.attempt <= q.attempt).length
    return `${sub?.name ?? ''} · ${ch?.title ?? ''} · provinha ${n}`
  }
  const child = profile?.role === 'child'
  const pending = quizzes.filter((q) => q.status === 'disponivel')
  const done = quizzes.filter((q) => q.status !== 'disponivel')

  const open = quizzes.find((q) => q.id === openId)
  if (open) return <QuizView quiz={open} title={label(open)} canAnswer={child && open.status === 'disponivel'} onClose={() => { setOpenId(null); reload() }} />

  return (
    <div className="stack">
      <h2>Provinhas de revisão</h2>
      <p className="muted small">Quando um capítulo termina, chega uma provinha. Abaixo de 7, vem outra, até passar. Revisões 🔁 aparecem quando vale reforçar um assunto.</p>
      {pending.length === 0 && <p className="banner">Nenhuma provinha pendente agora.</p>}
      {pending.map((q) => (
        <button key={q.id} className="card left" onClick={() => setOpenId(q.id)}>
          <strong>{q.kind === 'bloco' ? '🔁' : '📝'} {label(q)}</strong><br /><span className="small muted">{q.questions.length} questões{q.due_on ? ` · até ${fmtDay(q.due_on)}` : ''} · {child ? 'toque para fazer' : 'aguardando ele fazer'}</span>
        </button>
      ))}
      {done.length > 0 && <h3>Feitas</h3>}
      {done.map((q) => (
        <button key={q.id} className="card left" onClick={() => setOpenId(q.id)}>
          <div className="row between">
            <span>{label(q)}</span>
            {q.status === 'corrigida'
              ? <span className={'score ' + ((q.score ?? 0) >= 7 ? 'ok' : 'bad')}>{q.score?.toFixed(1)}</span>
              : <span className="small muted">corrigindo…</span>}
          </div>
        </button>
      ))}
      <hr />
      <ProvasEscola subjects={subjects} chapters={chapters} />
    </div>
  )
}

function QuizView({ quiz, title, canAnswer, onClose }: { quiz: Quiz; title: string; canAnswer: boolean; onClose: () => void }) {
  const { profile } = useSession()
  const [answers, setAnswers] = useState<Record<string, string>>(quiz.answers ?? {})
  const [files, setFiles] = useState<File[]>([])
  const [sent, setSent] = useState<Photo[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    supabase.from('quiz_photos').select('*').eq('quiz_id', quiz.id).order('sort')
      .then(({ data }) => setSent(((data ?? []) as any[]).map((p) => ({ ...p, item_id: '', page_number: null, version: 1 }))))
  }, [quiz.id])

  async function submit() {
    const missing = quiz.questions.filter((q) => !answers[q.id]?.trim())
    if (missing.length && !files.length && !confirm(`Faltam ${missing.length} questões. Entregar assim mesmo?`)) return
    setBusy(true); setErr(null)
    try {
      const paths: string[] = []
      for (const f of files) paths.push(await uploadToBucket(profile!.family_id, 'provinhas/' + quiz.id, f))
      const { error } = await supabase.rpc('submit_quiz', { p_quiz_id: quiz.id, p_answers: answers, p_photos: paths })
      if (error) throw error
      onClose()
    } catch (e: any) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div className="stack">
      <button className="link" onClick={onClose}>← voltar</button>
      <h2>{title}</h2>
      {quiz.ai_prompt && <CopyPrompt text={quiz.ai_prompt} />}
      {quiz.status === 'corrigida' && <p className={'banner ' + ((quiz.score ?? 0) >= 7 ? 'ok' : 'warn')}>Nota {quiz.score?.toFixed(1)} {(quiz.score ?? 0) >= 7 ? '— capítulo dominado!' : '— vem outra provinha para treinar.'}</p>}
      {quiz.questions.map((q, i) => {
        const fb = quiz.feedback?.[q.id]
        return (
          <div key={q.id} className="card stack">
            <p><b>{i + 1}.</b> {q.prompt}</p>
            {q.type === 'multipla' ? (
              <div className="stack tight">
                {q.options?.map((opt, j) => {
                  const letter = String.fromCharCode(65 + j)
                  return (
                    <label key={j} className="option">
                      <input type="radio" name={q.id} disabled={!canAnswer} checked={answers[q.id] === letter} onChange={() => setAnswers({ ...answers, [q.id]: letter })} />
                      <span><b>{letter})</b> {opt}</span>
                    </label>
                  )
                })}
              </div>
            ) : (
              <textarea rows={4} disabled={!canAnswer} value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
            )}
            {fb && <p className={'note ' + (fb.correct ? 'ok' : 'danger')}>{fb.correct ? '✅' : '❌'} {fb.comment}</p>}
          </div>
        )
      })}
      {canAnswer && (
        <div className="card stack">
          <b>Prefere responder no papel?</b>
          <p className="small muted">Escreva no caderno (com o número de cada questão), tire foto e mande aqui. Pode misturar: marcar umas no app e mandar outras por foto.</p>
          <label className="button">📷 Fotos das respostas ({files.length})
            <input hidden type="file" accept="image/*" capture="environment" multiple onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
          </label>
          {files.length > 0 && <button className="link small" onClick={() => setFiles([])}>Limpar fotos escolhidas</button>}
        </div>
      )}
      {sent.length > 0 && <><p className="small muted">Respostas enviadas por foto:</p><Photos photos={sent} /></>}
      {err && <p className="note danger">{err}</p>}
      {canAnswer && <button className="primary big" disabled={busy} onClick={submit}>{busy ? 'Enviando…' : 'Entregar provinha'}</button>}
    </div>
  )
}

export function CopyPrompt({ text }: { text: string }) {
  const [ok, setOk] = useState(false)
  return (
    <div className="note">
      <b>Quer treinar mais?</b> Copie este pedido e cole no ChatGPT, Gemini ou outra IA. Ela monta outra revisão no mesmo estilo.
      <div><button className="small" onClick={async () => { setOk(await copyText(text)); setTimeout(() => setOk(false), 2500) }}>{ok ? 'Copiado! ✓' : '📋 Copiar pedido'}</button></div>
    </div>
  )
}
