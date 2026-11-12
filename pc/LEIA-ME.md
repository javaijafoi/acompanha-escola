# Corrigir na hora pelo PC (com Telegram)

**Como funciona:** com o PC ligado e a janela do corretor aberta, um vigia confere a fila a cada minuto. Quando o
Pantoja entrega, a correção começa em 1 a 2 minutos e você recebe o resumo no Telegram. PC desligado ou janela
fechada: as rotinas da tarde (dias úteis 14h50, 15h50 e 16h50) corrigem o que sobrou. Uma trava no banco garante
que o PC e as rotinas nunca corrigem a mesma entrega duas vezes.

O Telegram serve para **você** falar com o corretor ("status", "corrigir") e receber os resumos e os pedidos de
permissão. O Pantoja não precisa de Telegram: o aviso de entrega vem do próprio app, pelo vigia.

## Configurar (uma vez, uns 10 minutos)

Abra o **PowerShell** e siga na ordem.

**1. Bun** (o plugin do Telegram roda nele)
```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```
Feche e abra o PowerShell de novo. `bun --version` tem que mostrar um número.

**2. Claude Code** (pule se `claude --version` já funciona)
```powershell
irm https://claude.ai/install.ps1 | iex
```
Rode `claude` uma vez e entre com a sua conta do claude.ai (a mesma da assinatura).

**3. Baixar o projeto**
```powershell
git clone https://github.com/javaijafoi/acompanha-escola "$HOME\Documents\acompanha-escola"
cd "$HOME\Documents\acompanha-escola\pc"
```

**4. Criar o bot no Telegram**
No Telegram, abra o **@BotFather**, mande `/newbot`, escolha um nome (ex.: "Corretor do Pantoja") e um usuário
terminado em `bot` (ex.: `corretor_pantoja_bot`). Copie o token que ele devolve (algo como `123456789:AAH...`).

**5. Instalar o plugin e salvar o token** (ainda na pasta `pc`)
```powershell
claude
```
Dentro do Claude Code:
```
/plugin install telegram@claude-plugins-official
```
Escolha o escopo **user**. Se disser que o marketplace não existe, rode antes
`/plugin marketplace add anthropics/claude-plugins-official`. Depois:
```
/telegram:configure COLE_O_TOKEN_AQUI
/exit
```

**6. Ligar o corretor**
Dê dois cliques em `Documents\acompanha-escola\pc\iniciar.cmd`.
Na primeira vez, aceite confiar na pasta. Ele confere o Supabase, cria a chave do vigia sozinho e liga o vigia.
Se ele disser que **falta o Supabase**: digite `/mcp` e veja se aparece "claude.ai Supabase" (é o conector que você
já ligou no claude.ai). Se não aparecer, saia (`/exit`) e rode no PowerShell, dentro da pasta `pc`:
```powershell
claude mcp add --transport http supabase "https://mcp.supabase.com/mcp?project_ref=klydltytocppfvofowbf"
```
Ligue de novo pelo `iniciar.cmd`, digite `/mcp`, escolha `supabase` e faça login.

**7. Parear o Telegram com você**
Com o corretor aberto, mande "oi" para o seu bot no Telegram. Ele responde com um código de 6 letras.
Na janela do corretor:
```
/telegram:access pair CODIGO
/telegram:access policy allowlist
```
Pronto: só você fala com o bot. **Não pareie o Pantoja** (quem está na lista pode aprovar ações no seu PC).

**8. Testar:** mande `status` para o bot. Ele responde com o que está na fila.

## No dia a dia

- Ligue o PC e dê dois cliques no `iniciar.cmd`. Deixe a janela aberta (pode minimizar).
- Para ligar sozinho com o Windows: aperte `Win + R`, digite `shell:startup` e cole lá um atalho do `iniciar.cmd`.
- No Telegram: `status` (o que está na fila), `corrigir` (roda agora), ou pergunte qualquer coisa sobre o Pantoja.
- Se o Claude precisar de uma permissão nova, o pedido chega no Telegram com botões. Toque em permitir.
- O PC não pode estar dormindo: em Configurações > Energia, deixe "suspender" em "Nunca" nas horas de estudo.
