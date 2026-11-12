# AcompanhaEscola

PWA para acompanhar os estudos da filha: diário diário por matéria com fotos das folhas,
correção feita pelo Claude, folhinhas de revisão e provinhas de fim de capítulo (refaz até tirar 7).

- **Frontend:** Vite + React + TypeScript, publicado na Vercel (`npm run build`, saída em `dist/`).
- **Backend:** Supabase (`klydltytocppfvofowbf`): Auth, Postgres com RLS, Storage (bucket privado `folhas`).
- **Correção:** sem servidor próprio e sem chave de API. Tarefas agendadas do Claude (assinatura) rodam
  em dias úteis à tarde e seguem [CORRECAO.md](CORRECAO.md). Também dá pra pedir uma rodada a qualquer hora.

## Fluxo
1. A aluna cria o diário do dia: matéria, capítulo, o que aprendeu, folhas e fotos. Toca em **Entregar o dia**.
2. A rodada de correção pega os dias `entregue`, lê as fotos, aceita ou devolve cada matéria, corrige e gera a folhinha.
3. Matéria devolvida: ela faz os exercícios, toca em **Refazer as folhas devolvidas** e entrega de novo.
4. Quando um capítulo termina (aba Matérias › Terminei), a próxima rodada gera a provinha. Nota < 7 gera outra.
5. O pai vê no **Painel**: entregas, alerta se não entregou até as 17h, desempenho por matéria e observações.

## Contas
1. O responsável cria a conta sem código de família (vira `parent` de uma família nova).
2. No painel aparece o **código da família**. A aluna cria a conta dela informando esse código (vira `child`).

## Desenvolvimento
```bash
cp .env.example .env.local
npm install
npm run dev
```
Migrações em `supabase/migrations`, edge function em `supabase/functions/fotos-pendentes`.
