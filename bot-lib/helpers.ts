export function env(key: string): string {
  return process.env[key] || ''
}

// Overridable for testing
let _mockToday: string | null = null
export function setMockToday(date: string | null) { _mockToday = date }

export function getTodayTaipei(): string {
  if (_mockToday) return _mockToday
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

export function addDaysToDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00+08:00')
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

export function supabaseHeaders() {
  const key = env('SUPABASE_ANON_KEY')
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
}

export function supabaseUrl(path: string): string {
  return `${env('SUPABASE_URL')}/rest/v1/${path}`
}
