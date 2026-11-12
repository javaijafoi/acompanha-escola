// Edge function usada só pela rodada de correção do Claude.
// Recebe ?token=... (gerado via SQL em public.worker_tokens, vale 1h) e devolve
// URLs assinadas (10 min) das fotos dos check-ins com status 'corrigindo'.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('token') ?? ''
  if (!/^[0-9a-f]{48}$/.test(token)) return new Response('unauthorized', { status: 401 })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: tok } = await admin.from('worker_tokens').select('token')
    .eq('token', token).gt('expires_at', new Date().toISOString()).maybeSingle()
  if (!tok) return new Response('unauthorized', { status: 401 })

  const { data: rows, error } = await admin
    .from('photos')
    .select('id, item_id, storage_path, checkin_items!inner(checkin_id, checkins!inner(status))')
    .eq('checkin_items.checkins.status', 'corrigindo')
  if (error) return new Response(error.message, { status: 500 })

  const paths = (rows ?? []).map((r) => r.storage_path)
  const { data: signed } = paths.length
    ? await admin.storage.from('folhas').createSignedUrls(paths, 600)
    : { data: [] as { path: string | null; signedUrl: string }[] }
  const byPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]))

  return Response.json((rows ?? []).map((r) => ({
    photo_id: r.id, item_id: r.item_id, storage_path: r.storage_path, url: byPath.get(r.storage_path) ?? null,
  })))
})
