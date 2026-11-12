import { supabase, BUCKET } from './supabase'
import type { Chapter, Subject } from './types'

export async function loadSubjects(includeInactive = false): Promise<Subject[]> {
  let q = supabase.from('subjects').select('*').order('name')
  if (!includeInactive) q = q.eq('active', true)
  const { data } = await q
  return (data ?? []) as Subject[]
}

export async function loadChapters(): Promise<Chapter[]> {
  const { data } = await supabase.from('chapters').select('*').order('created_at')
  return (data ?? []) as Chapter[]
}

export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {}
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
  const out: Record<string, string> = {}
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl
  return out
}

/** Reduz a foto no próprio aparelho antes de subir (folha legível, arquivo leve). */
export async function shrinkImage(file: File, maxSide = 1600): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/heic') return file
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  return await new Promise((res) => canvas.toBlob((b) => res(b ?? file), 'image/jpeg', 0.75))
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy'); ta.remove(); return ok
  }
}

/** Grade ativa: weekday (1=seg) -> lista de subject_id na ordem das aulas. */
export async function loadActiveTimetable(): Promise<Record<number, string[]>> {
  const { data: t } = await supabase.from('timetables').select('id').eq('status', 'ativa').order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!t) return {}
  const { data: slots } = await supabase.from('timetable_slots').select('*').eq('timetable_id', t.id).order('position')
  const out: Record<number, string[]> = {}
  for (const s of slots ?? []) (out[s.weekday] ??= []).includes(s.subject_id) || out[s.weekday].push(s.subject_id)
  return out
}

export async function uploadToBucket(familyId: string, folder: string, file: File): Promise<string> {
  const blob = await shrinkImage(file)
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/heic' ? 'heic' : 'jpg'
  const path = `${familyId}/${folder}/${crypto.randomUUID()}.${ext}`
  const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg' })
  if (up.error) throw up.error
  return path
}
