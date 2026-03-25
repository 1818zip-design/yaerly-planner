/**
 * Monthly Summary - Telegram Bot
 *
 * Runs on the 1st of each month. Aggregates the previous month's data
 * and sends a summary via Telegram with a Claude-generated review.
 *
 * Environment variables:
 *   SUPABASE_URL, SUPABASE_ANON_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
 *   ANTHROPIC_API_KEY
 *
 * Vercel Cron: "0 0 1 * *" (midnight UTC on the 1st = 8 AM Taipei)
 */

import Anthropic from '@anthropic-ai/sdk'

function env(key: string): string {
  return process.env[key] || ''
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

async function supabaseFetch(table: string, startDate: string, endDate: string): Promise<unknown[]> {
  const res = await fetch(
    supabaseUrl(`${table}?date=gte.${startDate}&date=lte.${endDate}&order=date`),
    { headers: supabaseHeaders() },
  )
  if (!res.ok) return []
  return res.json()
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

function getLastMonthRange(): { startDate: string; endDate: string; label: string } {
  const now = new Date()
  const taipeiNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }))
  const year = taipeiNow.getMonth() === 0 ? taipeiNow.getFullYear() - 1 : taipeiNow.getFullYear()
  const month = taipeiNow.getMonth() === 0 ? 12 : taipeiNow.getMonth()
  const lastDay = new Date(year, month, 0).getDate()
  const mm = String(month).padStart(2, '0')
  return {
    startDate: `${year}-${mm}-01`,
    endDate: `${year}-${mm}-${lastDay}`,
    label: `${year} 年 ${month} 月`,
  }
}

interface TaskRow { completed: boolean }
interface HabitLogRow { habit_id: string; completed: boolean }
interface HabitDefRow { id: string; name: string }
interface ExpenseRow { amount: number; category: string }
interface MoodRow { energy: number }

async function main() {
  const { startDate, endDate, label } = getLastMonthRange()
  console.log(`[monthly-summary] Generating summary for ${label} (${startDate} ~ ${endDate})`)

  // Fetch all data in parallel
  const [tasks, habitLogs, habitDefsRes, expenses, moods] = await Promise.all([
    supabaseFetch('tasks', startDate, endDate) as Promise<TaskRow[]>,
    supabaseFetch('habit_logs', startDate, endDate) as Promise<HabitLogRow[]>,
    fetch(supabaseUrl('habit_definitions?order=created_at'), { headers: supabaseHeaders() })
      .then(r => r.ok ? r.json() as Promise<HabitDefRow[]> : []),
    supabaseFetch('expenses', startDate, endDate) as Promise<ExpenseRow[]>,
    supabaseFetch('mood', startDate, endDate) as Promise<MoodRow[]>,
  ])

  // --- Task stats ---
  const totalTasks = tasks.length
  const completedTasks = tasks.filter(t => t.completed).length
  const taskRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

  // --- Habit stats ---
  const habitStats = habitDefsRes.map(def => {
    const logs = habitLogs.filter(l => l.habit_id === def.id && l.completed)
    return { name: def.name, done: logs.length }
  })

  // --- Expense stats ---
  const totalExpense = expenses.reduce((s, e) => s + e.amount, 0)
  const byCategory: Record<string, number> = {}
  for (const e of expenses) {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount
  }
  const categoryLines = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => `  ${cat}: $${amt.toLocaleString()}（${Math.round((amt / totalExpense) * 100)}%）`)

  // --- Mood stats ---
  const avgMood = moods.length > 0
    ? (moods.reduce((s, m) => s + m.energy, 0) / moods.length).toFixed(1)
    : '無記錄'

  // --- Build stats text ---
  const statsText = [
    `任務完成率：${completedTasks}/${totalTasks}（${taskRate}%）`,
    `習慣打卡：${habitStats.map(h => `${h.name} ${h.done} 天`).join('、') || '無記錄'}`,
    `花費總計：$${totalExpense.toLocaleString()}`,
    categoryLines.length > 0 ? categoryLines.join('\n') : '',
    `心情平均：${avgMood}`,
  ].filter(Boolean).join('\n')

  // --- Claude review + score ---
  let review = ''
  let score = 0
  const apiKey = env('ANTHROPIC_API_KEY')
  if (apiKey) {
    try {
      const client = new Anthropic({ apiKey })
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 256,
        system: '你是一個生活教練。根據用戶的月度數據，給出一段繁體中文評語（100字以內，簡潔有溫度，不用 markdown），以及一個 1-10 的綜合評分。格式：先寫評語，最後一行寫「評分：X/10」。',
        messages: [{
          role: 'user',
          content: `${label} 的數據：\n${statsText}`,
        }],
      })
      const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('')
      const scoreMatch = text.match(/評分[：:]\s*(\d+)/)
      score = scoreMatch ? parseInt(scoreMatch[1]) : 0
      review = text.replace(/評分[：:]\s*\d+\/10/, '').trim()
    } catch (err) {
      console.error('[monthly-summary] Claude error:', err)
      review = '（AI 評語生成失敗）'
    }
  }

  // --- Build Telegram message ---
  const message = [
    `📊 <b>${label} 月度總結</b>`,
    '',
    `✅ 任務：${completedTasks}/${totalTasks} 完成（${taskRate}%）`,
    '',
    `📅 習慣打卡：`,
    ...habitStats.map(h => `  • ${h.name}：${h.done} 天`),
    '',
    `💰 花費：$${totalExpense.toLocaleString()}`,
    ...categoryLines,
    '',
    `😊 心情平均：${avgMood}/5`,
    '',
    score > 0 ? `🏆 綜合評分：${score}/10` : '',
    '',
    review,
  ].filter(s => s !== undefined).join('\n')

  if (!env('TELEGRAM_BOT_TOKEN') || !env('TELEGRAM_CHAT_ID')) {
    console.log('[monthly-summary] Telegram not configured:')
    console.log(message)
    return { message, sent: false }
  }

  await sendTelegram(message)
  console.log('[monthly-summary] Sent to Telegram')
  return { message, sent: true }
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
    console.error('[monthly-summary] Error:', err)
    return res.status(500).json({ error: String(err) })
  }
}

// --- CLI mode ---
if (process.argv[1]?.includes('monthly-summary')) {
  await import('dotenv/config')
  main().then(r => {
    console.log('Done:', r.sent ? 'sent' : 'not sent')
    process.exit(0)
  }).catch(e => {
    console.error(e)
    process.exit(1)
  })
}
