// Edge function usada pelo vigia do PC do Peter (pc/vigia.sh).
// Recebe o cabeçalho x-ae-key (gerado com `select w_new_watch_key('pc')`) e devolve só contagens da fila:
// {para_corrigir, status, rodada_aberta}. Não devolve nenhum dado do aluno.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

Deno.serve(async (req) => {
  const key = req.headers.get('x-ae-key') ?? ''
  if (!/^[0-9a-f]{48}$/.test(key)) return new Response('unauthorized', { status: 401 })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data, error } = await admin.rpc('w_watch', { p_key: key })
  if (error) return new Response(error.message, { status: 500 })
  if (!data) return new Response('unauthorized', { status: 401 })
  return Response.json(data)
})
