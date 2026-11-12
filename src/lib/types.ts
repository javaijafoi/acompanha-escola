export type Role = 'parent' | 'child'

export interface Profile { id: string; family_id: string; role: Role; name: string }
export interface Family { id: string; name: string; invite_code: string; timezone: string }
export interface Subject { id: string; name: string; active: boolean; last_seen_on: string | null }
export interface Chapter {
  id: string; subject_id: string; title: string
  status: 'em_andamento' | 'finalizado' | 'dominado'; finished_at: string | null
}
export type CheckinStatus = 'rascunho' | 'entregue' | 'corrigindo' | 'corrigido'
export interface Checkin {
  id: string; child_id: string; day: string; status: CheckinStatus
  submitted_at: string | null; reviewed_at: string | null
}
export interface CheckinItem {
  id: string; checkin_id: string; subject_id: string; chapter_id: string | null
  learned: string; pages: string; review_status: 'pendente' | 'aceito' | 'devolvido'
}
export interface Photo { id: string; item_id: string; storage_path: string }
export interface ExerciseResult {
  ref: string; status: 'certo' | 'errado' | 'parcial' | 'em_branco'; feedback?: string
}
export interface Review {
  id: string; item_id: string; verdict: 'aceito' | 'devolvido'; topics: string[]
  summary: string; message_to_child: string; note_to_parent: string
  exercises: ExerciseResult[]; done_ratio: number | null; correct_ratio: number | null
  revision_sheet: string; created_at: string
}
export interface QuizQuestion {
  id: string; type: 'multipla' | 'aberta'; prompt: string; options?: string[]
}
export interface Quiz {
  id: string; chapter_id: string; attempt: number
  status: 'disponivel' | 'respondida' | 'corrigida'
  questions: QuizQuestion[]; answers: Record<string, string> | null
  score: number | null; feedback: Record<string, { correct: boolean; comment: string }> | null
  created_at: string; graded_at: string | null
}
