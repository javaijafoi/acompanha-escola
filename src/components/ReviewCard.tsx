import { useState } from 'react'
import Markdown from 'react-markdown'
import type { Review } from '../lib/types'
import { pct } from '../lib/dates'

const LABEL: Record<string, string> = { certo: '✅ certo', errado: '❌ errado', parcial: '🟡 parcial', em_branco: '⬜ em branco' }

export default function ReviewCard({ review, forParent = false }: { review: Review; forParent?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={'review ' + review.verdict}>
      <div className="row between">
        <strong>{review.verdict === 'aceito' ? 'Aceito' : 'Devolvido: precisa fazer os exercícios'}</strong>
        <span className="small muted">feitos {pct(review.done_ratio)} · acertos {pct(review.correct_ratio)}</span>
      </div>
      {review.message_to_child && <p>{review.message_to_child}</p>}
      {forParent && review.note_to_parent && <p className="note">Para você: {review.note_to_parent}</p>}
      {review.topics.length > 0 && (
        <div className="chips">{review.topics.map((t) => <span key={t} className="chip">{t}</span>)}</div>
      )}
      {review.exercises.length > 0 && (
        <details>
          <summary>Exercícios ({review.exercises.length})</summary>
          <ul className="exercises">
            {review.exercises.map((x, i) => (
              <li key={i}><b>{x.ref}</b> {LABEL[x.status] ?? x.status}{x.feedback ? <> · {x.feedback}</> : null}</li>
            ))}
          </ul>
        </details>
      )}
      {review.revision_sheet && (
        <>
          <button className="link" onClick={() => setOpen(!open)}>{open ? 'Fechar' : 'Ver'} folhinha de revisão</button>
          {open && <div className="sheet"><Markdown>{review.revision_sheet}</Markdown></div>}
        </>
      )}
    </div>
  )
}
