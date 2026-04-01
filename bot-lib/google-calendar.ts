import { env } from './helpers.js'

export interface CalendarEventInput {
  title: string
  date: string
  start_time: string
  end_time?: string
  location?: string
}

async function getGoogleAccessToken(): Promise<string | null> {
  const clientId = env('GOOGLE_CLIENT_ID')
  const clientSecret = env('GOOGLE_CLIENT_SECRET')
  const refreshToken = env('GOOGLE_REFRESH_TOKEN')
  if (!clientId || !clientSecret || !refreshToken) return null

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    console.error('[Google OAuth] Token refresh failed:', await res.text())
    return null
  }
  const data = await res.json() as { access_token: string }
  return data.access_token
}

export async function createCalendarEvent(input: CalendarEventInput): Promise<string> {
  const accessToken = await getGoogleAccessToken()
  if (!accessToken) return '❌ Google Calendar 未設定（缺少 OAuth 憑證）'

  const calendarId = env('GOOGLE_CALENDAR_ID') || 'primary'
  const { title, date, start_time, location } = input

  let endTime = input.end_time
  if (!endTime) {
    const [h, m] = start_time.split(':').map(Number)
    endTime = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  const event = {
    summary: title,
    start: { dateTime: `${date}T${start_time}:00`, timeZone: 'Asia/Taipei' },
    end: { dateTime: `${date}T${endTime}:00`, timeZone: 'Asia/Taipei' },
    ...(location ? { location } : {}),
  }

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    },
  )

  if (!res.ok) {
    const errText = await res.text()
    console.error('[Google Calendar] Create event failed:', errText)
    return `❌ 新增行程失敗：${errText.slice(0, 100)}`
  }

  const created = await res.json() as { htmlLink: string }
  return `已新增行程「${title}」到 Google Calendar（${date} ${start_time}~${endTime}）\n${created.htmlLink}`
}

export interface CalendarEvent {
  id: string
  summary: string
  start: { dateTime?: string; date?: string }
  end: { dateTime?: string; date?: string }
  location?: string
}

export async function listCalendarEvents(date: string): Promise<CalendarEvent[]> {
  const accessToken = await getGoogleAccessToken()
  if (!accessToken) return []

  const calendarId = env('GOOGLE_CALENDAR_ID') || 'primary'
  const timeMin = `${date}T00:00:00+08:00`
  const timeMax = `${date}T23:59:59+08:00`

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!res.ok) return []
  const data = await res.json() as { items: CalendarEvent[] }
  return data.items || []
}

export async function deleteCalendarEvent(eventId: string): Promise<string> {
  const accessToken = await getGoogleAccessToken()
  if (!accessToken) return '❌ Google Calendar 未設定'

  const calendarId = env('GOOGLE_CALENDAR_ID') || 'primary'
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!res.ok) {
    const errText = await res.text()
    return `❌ 刪除失敗：${errText.slice(0, 100)}`
  }
  return 'ok'
}
