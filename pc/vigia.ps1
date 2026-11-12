# Vigia de entregas do AcompanhaEscola (roda no PC do Peter, dentro da sessão do Claude Code).
# Consulta a fila a cada 60 s. Sai (e com isso acorda o Claude) quando:
#   NOVA_ENTREGA ...  -> tem coisa para corrigir e ninguém está corrigindo (confirmado em 2 consultas seguidas)
#   VIGIA_RENOVAR     -> passaram 110 min sem nada; o Claude só liga o vigia de novo
#   VIGIA_ERRO ...    -> 10 falhas seguidas (sem internet, chave errada)
# Não lê nenhum dado do aluno: a função "fila" só devolve contagens.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$key = ''
if (Test-Path .env) {
  $line = Get-Content .env | Where-Object { $_ -match '^AE_WATCH_KEY=' } | Select-Object -First 1
  if ($line) { $key = ($line -replace '^AE_WATCH_KEY=', '').Trim() }
}
if (-not $key) { Write-Output 'VIGIA_ERRO falta AE_WATCH_KEY no arquivo .env'; exit 1 }

$url = 'https://klydltytocppfvofowbf.supabase.co/functions/v1/fila'
$fim = (Get-Date).AddMinutes(110)
$seguidas = 0
$falhas = 0
while ((Get-Date) -lt $fim) {
  try {
    $r = Invoke-RestMethod -Uri $url -Headers @{ 'x-ae-key' = $key } -TimeoutSec 20
    $falhas = 0
    if ([int]$r.para_corrigir -gt 0 -and -not $r.rodada_aberta) {
      $seguidas++
      if ($seguidas -ge 2) {
        Write-Output ("NOVA_ENTREGA para_corrigir={0} as {1}" -f $r.para_corrigir, (Get-Date -Format 'HH:mm'))
        exit 0
      }
    } else { $seguidas = 0 }
  } catch {
    $falhas++
    if ($falhas -ge 10) { Write-Output ("VIGIA_ERRO {0}" -f $_.Exception.Message); exit 2 }
  }
  Start-Sleep -Seconds 60
}
Write-Output 'VIGIA_RENOVAR'
exit 0
