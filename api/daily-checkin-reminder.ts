/**
 * Daily Check-in Reminder
 *
 * Runs at 21:00 Taipei time (UTC 13:00).
 * Checks what's missing today (expenses, habits, mood)
 * and sends a Telegram reminder.
 */

function env(key: string): string {
  return process.env[key] || ''
}

function getTodayTaipei(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

function supabaseHeaders() {
  const key = env('SUPABASE_ANON_KEY')
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }
}

function supabaseUrl(path: string): string {
  return `${env('SUPABASE_URL')}/rest/v1/${path}`
}

async function sendTelegram(text: string): Promise<void> {
  const truncated = text.length > 4000 ? text.slice(0, 4000) + '...' : text
  await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env('TELEGRAM_CHAT_ID'),
      text: truncated,
      parse_mode: 'HTML',
    }),
  })
}

async function main() {
  const today = getTodayTaipei()
  console.log(`[daily-checkin] Checking for ${today}`)

  const h = supabaseHeaders()
  const [expRes, habitRes, habitDefRes, moodRes] = await Promise.all([
    fetch(supabaseUrl(`expenses?date=eq.${today}&limit=1`), { headers: h }),
    fetch(supabaseUrl(`habit_logs?date=eq.${today}&limit=1`), { headers: h }),
    fetch(supabaseUrl(`habit_definitions?limit=1`), { headers: h }),
    fetch(supabaseUrl(`mood?date=eq.${today}&limit=1`), { headers: h }),
  ])

  const expenses = expRes.ok ? await expRes.json() as unknown[] : []
  const habits = habitRes.ok ? await habitRes.json() as unknown[] : []
  const habitDefs = habitDefRes.ok ? await habitDefRes.json() as unknown[] : []
  const moods = moodRes.ok ? await moodRes.json() as unknown[] : []

  const missing: string[] = []
  if (expenses.length === 0) missing.push('💰 記帳')
  if (habitDefs.length > 0 && habits.length === 0) missing.push('📅 習慣打卡')
  if (moods.length === 0) missing.push('😊 心情記錄')

  if (missing.length === 0) {
    console.log('[daily-checkin] All done, no reminder needed')
    return { sent: false, reason: 'all done' }
  }

  const message = [
    `🌙 晚安！今天還有幾個沒記錄：`,
    '',
    ...missing,
    '',
    `回覆「好」我帶你一個個補上，或直接自己記也行`,
  ].join('\n')

  if (!env('TELEGRAM_BOT_TOKEN') || !env('TELEGRAM_CHAT_ID')) {
    console.log('[daily-checkin] Telegram not configured:')
    console.log(message)
    return { sent: false, message }
  }

  await sendTelegram(message)
  console.log('[daily-checkin] Sent reminder')
  return { sent: true, missing: missing.length }
}

// --- Vercel handler ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const result = await main()
    return res.status(200).json({ ok: true, ...result })
  } catch (err) {
    console.error('[daily-checkin] Error:', err)
    return res.status(500).json({ error: String(err) })
  }
}

// --- CLI mode ---
if (process.argv[1]?.includes('daily-checkin')) {
  await import('dotenv/config')
  main().then(r => { console.log('Done:', r); process.exit(0) })
    .catch(e => { console.error(e); process.exit(1) })
}
