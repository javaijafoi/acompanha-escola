export type Role = 'parent' | 'child'

export interface Profile { id: string; family_id: string; role: Role; name: string }
export interface Family { id: string; name: string; invite_code: string; timezone: string }
export interface Subject { id: string; name: string; active: boolean; last_seen_on: string | null }
export interface Chapter {
  id: string; subject_id: string; title: string
  status: 'em_andamento' | 'finalizado' | 'dominado'; finished_at: string | null
  book_id: string | null; start_page: number | null; end_page: number | null; position: number | null
  summary_sheet: string; ai_prompt: string
}
export interface Term { id: string; name: string; starts_on: string; ends_on: string }
export interface Book { id: string; title: string; term_id: string | null; status: 'aguardando_leitura' | 'cadastrado' | 'com_problema'; review_note: string; created_at: string }
export interface Timetable { id: string; valid_from: string; status: 'aguardando_leitura' | 'ativa' | 'bloqueada' | 'substituida'; child_reason: string; review_note: string; created_at: string }
export interface Slot { id: string; timetable_id: string; weekday: number; position: number; subject_id: string }
export interface Task {
  id: string; kind: string; subject_id: string | null; chapter_id: string | null; quiz_id: string | null
  title: string; instructions: string; due_on: string | null; status: 'pendente' | 'feita' | 'cancelada'; created_at: string
}
export interface Alert {
  id: string; kind: string; severity: 'info' | 'atencao' | 'bloqueio'; subject_id: string | null; chapter_id: string | null
  title: string; details: string; status: 'aberto' | 'resolvido'; created_at: string
}
export type CheckinStatus = 'rascunho' | 'entregue' | 'corrigindo' | 'corrigido'
export interface Checkin {
  id: string; child_id: string; day: string; status: CheckinStatus
  submitted_at: string | null; reviewed_at: string | null
}
export interface CheckinItem {
  id: string; checkin_id: string; subject_id: string; chapter_id: string | null
  learned: string; pages: string; review_status: 'pendente' | 'aceito' | 'devolvido'
  book_id: string | null; page_from: number | null; page_to: number | null; no_class_reason: string | null
}
export interface Photo { id: string; item_id: string; storage_path: string; page_number: number | null; sort: number | null }
export interface ExerciseResult {
  ref: string; status: 'certo' | 'errado' | 'parcial' | 'em_branco'; feedback?: string
}
export interface Review {
  id: string; item_id: string; verdict: 'aceito' | 'devolvido'; topics: string[]
  summary: string; message_to_child: string
  exercises: ExerciseResult[]; done_ratio: number | null; correct_ratio: number | null
  revision_sheet: string; created_at: string
}
export interface QuizQuestion {
  id: string; type: 'multipla' | 'aberta'; prompt: string; options?: string[]
}
export interface Quiz {
  id: string; chapter_id: string | null; subject_id: string | null; kind: 'capitulo' | 'bloco'; title: string
  due_on: string | null; ai_prompt: string; attempt: number
  status: 'disponivel' | 'respondida' | 'corrigida'
  questions: QuizQuestion[]; answers: Record<string, string> | null
  score: number | null; feedback: Record<string, { correct: boolean; comment: string }> | null
  created_at: string; graded_at: string | null
}
