@echo off
rem Liga o corretor do AcompanhaEscola neste PC (Telegram + vigia de entregas).
rem Deixe esta janela aberta. Fechou a janela ou desligou o PC: as rotinas da tarde corrigem o que sobrar.
cd /d "%~dp0"
git -C .. pull -q 2>nul
claude --channels plugin:telegram@claude-plugins-official "Comece o turno de correcao: siga o CLAUDE.md desta pasta."
