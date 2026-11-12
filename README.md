# AcompanhaEscola

PWA para acompanhar os estudos da filha: diário diário por matéria com fotos das folhas,
correção feita pelo Claude, folhinhas de revisão e provinhas de fim de capítulo (refaz até tirar 7).

- **Frontend:** Vite + React + TypeScript, publicado na Vercel (`npm run build`, saída em `dist/`).
- **Backend:** Supabase (`klydltytocppfvofowbf`): Auth, Postgres com RLS, Storage (bucket privado `folhas`).
- **Correção:** sem servidor próprio e sem chave de API. Tarefas agendadas do Claude (assinatura) rodam
  em dias úteis à tarde e seguem [CORRECAO.md](CORRECAO.md). Também dá pra pedir uma rodada a qualquer hora.
- **Correção na hora (opcional):** com o PC do responsável ligado, o corretor da pasta [`pc/`](pc/LEIA-ME.md)
  (Claude Code + Telegram) corrige assim que o aluno entrega. Uma trava no banco (`w_try_open_run`) impede
  que o PC e as rotinas corrijam a mesma entrega.

## Fluxo
1. **Ajustes:** foto da grade horária (se mudar, precisa explicar o porquê), foto do sumário de cada livro e trimestres.
   A rodada transcreve a grade e cadastra os capítulos com intervalo de páginas. Grade esquisita fica bloqueada para o responsável revisar.
2. **Hoje:** o aluno lança cada matéria da grade com páginas de/até e uma foto por página (mesmo em branco), ou marca "não teve conteúdo" com o motivo.
   Só consegue entregar com todas as matérias do dia e todas as fotos.
3. A rodada ordena as páginas, confere páginas faltando (inclusive buracos entre dias), corrige, devolve o que veio em branco,
   gera folhinha, revisões por bloco quando vale a pena e, quando o capítulo acaba (pelas páginas), a revisão obrigatória
   e a provinha (refaz até tirar 7).
4. Provinhas e capítulos têm **Copiar pedido** para treinar em outra IA. Só as provinhas do app contam.
5. O responsável vê no **Painel**: alertas (só ele vê), entregas, desempenho por matéria por trimestre, pendências e o diário.

## Contas
1. O responsável cria a conta sem código de família (vira `parent` de uma família nova).
2. Em Ajustes aparece o **código da família**. O aluno cria a conta dele informando esse código (vira `child`).
3. O perfil de aprendizagem (Ajustes, só o responsável vê) orienta o tom das correções.

## Desenvolvimento
```bash
cp .env.example .env.local
npm install
npm run dev
```
Migrações em `supabase/migrations`, edge functions em `supabase/functions` (`fotos-pendentes` para a rodada, `fila` para o vigia do PC).
