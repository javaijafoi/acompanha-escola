const TZ = 'America/Sao_Paulo'

/** Data de hoje (AAAA-MM-DD) no fuso de Brasília. */
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
}

/** Hora atual (0-23) em Brasília. */
export function hourNow(): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date()))
}

export function isWeekday(day = today()): boolean {
  const d = new Date(day + 'T12:00:00Z').getUTCDay()
  return d >= 1 && d <= 5
}

export function daysAgo(n: number): string {
  const d = new Date(today() + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

export function fmtDay(day: string): string {
  return new Date(day + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' })
}

export function pct(x: number | null | undefined): string {
  return x == null ? '–' : Math.round(x * 100) + '%'
}
