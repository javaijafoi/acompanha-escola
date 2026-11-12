// Edge function usada só pela rodada de correção do Claude.
// Recebe ?token=... (gerado com `select w_new_token()`, vale 1h) e devolve URLs assinadas (10 min)
// das fotos que a rodada precisa olhar: folhas dos dias em correção, sumários de livros e grades novas.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('token') ?? ''
  if (!/^[0-9a-f]{48}$/.test(token)) return new Response('unauthorized', { status: 401 })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: tok } = await admin.from('worker_tokens').select('token')
    .eq('token', token).gt('expires_at', new Date().toISOString()).maybeSingle()
  if (!tok) return new Response('unauthorized', { status: 401 })

  const [folhas, livros, grades] = await Promise.all([
    admin.from('photos')
      .select('id, item_id, storage_path, checkin_items!inner(checkin_id, checkins!inner(status))')
      .eq('checkin_items.checkins.status', 'corrigindo'),
    admin.from('book_photos').select('id, book_id, storage_path, books!inner(status)').eq('books.status', 'aguardando_leitura'),
    admin.from('timetable_photos').select('id, timetable_id, storage_path, timetables!inner(status)').eq('timetables.status', 'aguardando_leitura'),
  ])
  const err = folhas.error ?? livros.error ?? grades.error
  if (err) return new Response(err.message, { status: 500 })

  const all = [
    ...(folhas.data ?? []).map((r) => ({ tipo: 'folha', photo_id: r.id, item_id: r.item_id, storage_path: r.storage_path })),
    ...(livros.data ?? []).map((r) => ({ tipo: 'livro', photo_id: r.id, book_id: r.book_id, storage_path: r.storage_path })),
    ...(grades.data ?? []).map((r) => ({ tipo: 'grade', photo_id: r.id, timetable_id: r.timetable_id, storage_path: r.storage_path })),
  ]
  const paths = all.map((r) => r.storage_path)
  const { data: signed } = paths.length
    ? await admin.storage.from('folhas').createSignedUrls(paths, 600)
    : { data: [] as { path: string | null; signedUrl: string }[] }
  const byPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]))
  return Response.json(all.map((r) => ({ ...r, url: byPath.get(r.storage_path) ?? null })))
})
