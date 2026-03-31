/**
 * Daily Reminder - Telegram Bot
 *
 * At 10 PM Taipei time:
 * 1. Auto carry-over: move ALL past incomplete tasks to tomorrow
 * 2. Send a Telegram reminder with tomorrow's task list
 *
 * Environment variables needed:
 *   SUPABASE_URL, SUPABASE_ANON_KEY,
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */

// --- Types ---
interface Task {
  id: string
  title: string
  completed: boolean
  date: string
  carried_over: boolean
  original_date: string | null
  goal_id: string | null
  tags: string[]
  time_slot: string
}

// --- Config ---
function env(key: string): string {
  return process.env[key] || ''
}

function supabaseHeaders() {
  const key = env('SUPABASE_ANON_KEY')
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
}

function supabaseUrl(path: string): string {
  return `${env('SUPABASE_URL')}/rest/v1/${path}`
}

function getTodayTaipei(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

function getTomorrowTaipei(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

async function sendTelegram(text: string): Promise<void> {
  const truncated = text.length > 4000 ? text.slice(0, 4000) + '...' : text
  const res = await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env('TELEGRAM_CHAT_ID'),
      text: truncated,
      parse_mode: 'HTML',
    }),
  })
  if (!res.ok) {
    throw new Error(`Telegram error: ${res.status} ${await res.text()}`)
  }
}

// --- Main logic ---
async function main() {
  const today = getTodayTaipei()
  const tomorrow = getTomorrowTaipei()
  console.log(`[daily-reminder] Running for ${today}, carry-over target: ${tomorrow}`)

  // Step 1: Fetch ALL incomplete tasks up to today (any past date)
  const res = await fetch(
    supabaseUrl(`tasks?date=lte.${today}&completed=eq.false&order=date,created_at`),
    { headers: supabaseHeaders() },
  )
  if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`)
  const incompleteTasks: Task[] = await res.json()

  console.log(`[daily-reminder] Found ${incompleteTasks.length} incomplete tasks up to ${today}`)

  // Step 2: Check what's already on tomorrow to avoid duplicates
  const tomorrowRes = await fetch(
    supabaseUrl(`tasks?date=eq.${tomorrow}&order=created_at`),
    { headers: supabaseHeaders() },
  )
  const tomorrowTasks: Task[] = tomorrowRes.ok ? await tomorrowRes.json() : []
  const tomorrowTitles = new Set(tomorrowTasks.map(t => t.title))

  // Step 3: Carry over — create new tasks on tomorrow, delete originals
  const toCarry = incompleteTasks.filter(t => !tomorrowTitles.has(t.title))
  let carriedCount = 0

  if (toCarry.length > 0) {
    const inserts = toCarry.map(t => ({
      title: t.title,
      date: tomorrow,
      time_slot: t.time_slot,
      completed: false,
      goal_id: t.goal_id,
      tags: t.tags,
      carried_over: true,
      original_date: t.original_date || t.date,
    }))

    const insertRes = await fetch(supabaseUrl('tasks'), {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify(inserts),
    })

    if (insertRes.ok) {
      carriedCount = toCarry.length
      // Delete the originals
      const idsToDelete = toCarry.map(t => t.id)
      for (const id of idsToDelete) {
        await fetch(supabaseUrl(`tasks?id=eq.${id}`), {
          method: 'DELETE',
          headers: supabaseHeaders(),
        })
      }
      console.log(`[daily-reminder] Carried over ${carriedCount} tasks to ${tomorrow}`)
    } else {
      console.error('[daily-reminder] Insert failed:', await insertRes.text())
    }
  }

  // Step 4: Fetch tomorrow's final task list for the message
  const finalRes = await fetch(
    supabaseUrl(`tasks?date=eq.${tomorrow}&completed=eq.false&order=created_at`),
    { headers: supabaseHeaders() },
  )
  const finalTasks: Task[] = finalRes.ok ? await finalRes.json() : []

  // Step 5: Build and send message
  let message: string
  if (finalTasks.length === 0 && carriedCount === 0) {
    message = `✅ 今天任務全部完成了，明天目前沒有待辦！`
  } else {
    const lines = finalTasks.map(t => {
      const prefix = t.carried_over ? '↻ ' : ''
      return `• ${prefix}${t.title}`
    })
    const parts = [`📋 明天的任務（${finalTasks.length}項）：`, '', ...lines]
    if (carriedCount > 0) {
      parts.push('', `↻ 其中 ${carriedCount} 筆是從之前順延的`)
    }
    message = parts.join('\n')
  }

  if (!env('TELEGRAM_BOT_TOKEN') || !env('TELEGRAM_CHAT_ID')) {
    console.log('[daily-reminder] Telegram not configured:')
    console.log(message)
    return { message, sent: false, carried: carriedCount }
  }

  await sendTelegram(message)
  console.log('[daily-reminder] Telegram message sent')
  return { message, sent: true, carried: carriedCount }
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
    console.error('[daily-reminder] Error:', err)
    return res.status(500).json({ error: String(err) })
  }
}

// --- CLI mode ---
if (process.argv[1]?.includes('daily-reminder')) {
  await import('dotenv/config')
  main().then(r => {
    console.log('Done:', r)
    process.exit(0)
  }).catch(e => {
    console.error(e)
    process.exit(1)
  })
}
