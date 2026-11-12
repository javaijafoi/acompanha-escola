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
export async function shrinkImage(file: File, maxSide = 2000): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/heic') return file
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  return await new Promise((res) => canvas.toBlob((b) => res(b ?? file), 'image/jpeg', 0.85))
}
