/**
 * Daily Reminder - Telegram Bot
 *
 * Sends a list of today's incomplete tasks via Telegram at 10 PM Taipei time.
 *
 * Environment variables needed:
 *   SUPABASE_URL       - Supabase project URL
 *   SUPABASE_ANON_KEY  - Supabase anon key
 *   TELEGRAM_BOT_TOKEN      - Telegram Bot API token (from @BotFather)
 *   TELEGRAM_CHAT_ID        - Your Telegram chat ID (from @userinfobot)
 *
 * --- Deployment options ---
 *
 * Option A: Vercel Cron (recommended)
 *   1. Deploy this project to Vercel
 *   2. Add vercel.json with cron config (see bottom of file)
 *   3. Set env vars in Vercel dashboard
 *   The endpoint GET /api/daily-reminder will be called automatically.
 *
 * Option B: Any cron service / GitHub Actions / local crontab
 *   Run: npx tsx api/daily-reminder.ts
 */

// --- Types ---
interface Task {
  id: string
  title: string
  completed: boolean
  date: string
  carried_over: boolean
}

// --- Config (read at call time so dotenv/env injection works) ---
function env(key: string): string {
  return process.env[key] || ''
}

function getTodayTaipei(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

async function fetchIncompleteTasks(date: string): Promise<Task[]> {
  const url = `${env('SUPABASE_URL')}/rest/v1/tasks?date=eq.${date}&completed=eq.false&order=created_at`
  const key = env('SUPABASE_ANON_KEY')
  const res = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  })
  if (!res.ok) {
    throw new Error(`Supabase error: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

async function sendTelegram(text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/sendMessage`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env('TELEGRAM_CHAT_ID'),
      text,
      parse_mode: 'HTML',
    }),
  })
  if (!res.ok) {
    throw new Error(`Telegram error: ${res.status} ${await res.text()}`)
  }
}

function buildMessage(tasks: Task[], date: string): string {
  if (tasks.length === 0) {
    return `✅ ${date}\n今天的任務全部完成了！`
  }

  const lines = tasks.map(t => {
    const prefix = t.carried_over ? '↻ ' : ''
    return `• ${prefix}${t.title}`
  })

  return [
    `📋 今日未完成任務（${tasks.length}項）：`,
    '',
    ...lines,
    '',
    '記得完成或順延到明天！',
  ].join('\n')
}

// --- Main logic ---
async function main() {
  const today = getTodayTaipei()
  console.log(`[daily-reminder] Running for ${today}`)

  const tasks = await fetchIncompleteTasks(today)
  console.log(`[daily-reminder] Found ${tasks.length} incomplete tasks`)

  const message = buildMessage(tasks, today)

  if (!env('TELEGRAM_BOT_TOKEN') || !env('TELEGRAM_CHAT_ID')) {
    console.log('[daily-reminder] Telegram not configured, printing message:')
    console.log(message)
    return { message, sent: false }
  }

  await sendTelegram(message)
  console.log('[daily-reminder] Telegram message sent')
  return { message, sent: true }
}

// --- Vercel Serverless Function handler ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  // Verify cron secret if set (optional security)
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const result = await main()
    return res.status(200).json({ ok: true, ...result })
  } catch (err) {
    console.error('[daily-reminder] Error:', err)
    return res.status(500).json({ error: String(err) })
  }
}

// --- CLI mode: run directly with `npx tsx api/daily-reminder.ts` ---
if (process.argv[1]?.includes('daily-reminder')) {
  // Ensure .env is loaded
  await import('dotenv/config')
  main().then(r => {
    console.log('Done:', r)
    process.exit(0)
  }).catch(e => {
    console.error(e)
    process.exit(1)
  })
}
