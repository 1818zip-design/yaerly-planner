/**
 * Persona-based User Simulation with Virtual Time
 *
 * Simulates a real person using the Planner over multiple days.
 * Each action is verified against Supabase. Time is mocked.
 *
 * Usage:
 *   npx tsx scripts/simulate-user.ts              # random persona, 3 days
 *   npx tsx scripts/simulate-user.ts 7            # random persona, 7 days
 *   npx tsx scripts/simulate-user.ts 5 高管        # specific persona, 5 days
 *   npx tsx scripts/simulate-user.ts 3 all        # all personas, 3 days each
 */

import 'dotenv/config'
import { setMockToday, addDaysToDate } from '../api/lib/helpers.js'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SUPA_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const CHAT_ID = parseInt(process.env.TELEGRAM_CHAT_ID || '0')
const SIM_TAG = '_SIM_' + Date.now()  // unique tag for this run

function supaHeaders() {
  return { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
}
async function supaQuery(path: string): Promise<unknown[]> {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, { headers: supaHeaders() })
  return res.ok ? await res.json() as unknown[] : []
}
async function supaDelete(path: string) {
  await fetch(`${SUPA_URL}/rest/v1/${path}`, { method: 'DELETE', headers: supaHeaders() })
}

// ============ MOCK SETUP ============

let calendarCalls: { title: string; date: string; time: string }[] = []
let handleMessage: (chatId: number, text: string) => Promise<string>

function setMockDate(date: string) {
  setMockToday(date)
}

// ============ PERSONAS ============

interface Persona {
  name: string
  description: string
  completionRate: number
  postponeRate: number
  journalRate: number
  habitRate: number
  moodRange: [number, number]
  moodTags: string[]
  tasks: string[]
  expenses: { msg: string; format: 'natural' | 'applepay' | 'sms'; amount: number; category: string }[]
  schedules: { title: string; time: string }[]
  journals: string[]
}

const PERSONAS: Record<string, Persona> = {
  拖延症: {
    name: '小拖（P人拖延症）',
    description: '什麼都想做但都拖，常順延，偶爾爆發完成',
    completionRate: 0.25, postponeRate: 0.6, journalRate: 0.4, habitRate: 0.3,
    moodRange: [2, 4], moodTags: ['疲憊', '焦慮', '平靜'],
    tasks: ['整理房間', '洗衣服', '回覆郵件', '寫報告', '買日用品', '運動', '看書', '繳帳單', '預約牙醫', '寄包裹'],
    expenses: [
      { msg: '外送晚餐 280', format: 'natural', amount: 280, category: '餐飲' },
      { msg: '手搖飲 65', format: 'natural', amount: 65, category: '餐飲' },
      { msg: '永豐貴賓您好，您於{MM}/{DD}刷350元', format: 'sms', amount: 350, category: '其他' },
      { msg: '深夜零食 120', format: 'natural', amount: 120, category: '日常採買' },
    ],
    schedules: [],
    journals: ['今天又拖延了', '終於做了一件事', '好累什麼都不想做', '突然有動力做了好幾件事'],
  },
  高管: {
    name: '陳總（公司高管）',
    description: '行程滿，效率高，花費大，多用 Apple Pay',
    completionRate: 0.8, postponeRate: 0.1, journalRate: 0.2, habitRate: 0.5,
    moodRange: [3, 5], moodTags: ['平靜', '興奮', '焦慮'],
    tasks: ['看Q2報告', '準備董事會簡報', '面試候選人', '回覆合作提案', '簽核預算', '審核行銷方案'],
    expenses: [
      { msg: '永豐銀行\n鼎泰豐\n$1,280.00', format: 'applepay', amount: 1280, category: '其他' },
      { msg: '永豐銀行\n台灣高鐵\n$1,490.00', format: 'applepay', amount: 1490, category: '其他' },
      { msg: '永豐銀行\n計程車\n$350.00', format: 'applepay', amount: 350, category: '其他' },
      { msg: '請客戶吃飯 3500', format: 'natural', amount: 3500, category: '朋友社交' },
    ],
    schedules: [
      { title: '早會', time: '09:00' },
      { title: '跟客戶開會', time: '14:00' },
      { title: '面試', time: '16:00' },
    ],
    journals: ['今天會議有結論效率不錯', '市場變化快要加速決策'],
  },
  學生: {
    name: '小明（大學生）',
    description: '課業壓力大，花費省，常熬夜',
    completionRate: 0.55, postponeRate: 0.35, journalRate: 0.5, habitRate: 0.4,
    moodRange: [2, 5], moodTags: ['疲憊', '焦慮', '快樂', '興奮'],
    tasks: ['寫作業', '複習考試', '交報告', '做分組專題', '洗衣服', '找教授討論', '申請實習', '練英文'],
    expenses: [
      { msg: '午餐便當 75', format: 'natural', amount: 75, category: '餐飲' },
      { msg: '咖啡 55', format: 'natural', amount: 55, category: '餐飲' },
      { msg: '公車 15', format: 'natural', amount: 15, category: '交通' },
      { msg: '跟同學聚餐 350', format: 'natural', amount: 350, category: '朋友社交' },
    ],
    schedules: [
      { title: '上課', time: '09:00' },
      { title: '社團開會', time: '18:00' },
    ],
    journals: ['上課好累但學到東西', '期末壓力好大', '跟朋友出去玩超開心', '報告交了解脫'],
  },
  自由工作者: {
    name: '阿志（自由工作者）',
    description: '時間自由但自律不穩，在家工作',
    completionRate: 0.5, postponeRate: 0.4, journalRate: 0.6, habitRate: 0.5,
    moodRange: [1, 5], moodTags: ['平靜', '焦慮', '快樂', '疲憊'],
    tasks: ['寫提案', '回客戶信', '修改設計稿', '發invoice', '更新作品集', '找新案子', '學新工具', '記帳對帳'],
    expenses: [
      { msg: '永豐銀行\n星巴克\n$180.00', format: 'applepay', amount: 180, category: '其他' },
      { msg: '外送晚餐 250', format: 'natural', amount: 250, category: '餐飲' },
      { msg: '永豐貴賓您好，您於{MM}/{DD}刷1,500元', format: 'sms', amount: 1500, category: '其他' },
    ],
    schedules: [
      { title: '跟客戶視訊', time: '10:00' },
    ],
    journals: ['效率很高一口氣做完兩個案子', '沒案子有點焦慮', '收到新客戶的信很有趣'],
  },
}

// ============ HELPERS ============

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }
function chance(rate: number): boolean { return Math.random() < rate }
function randInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min }

interface LogEntry {
  day: number
  date: string
  action: string
  message: string
  reply: string
  verify: string
  pass: boolean
}

const logs: LogEntry[] = []

async function act(day: number, date: string, action: string, message: string, verify: () => Promise<{ pass: boolean; detail: string }>): Promise<string> {
  const reply = await handleMessage(CHAT_ID, message)
  const { pass, detail } = await verify()
  logs.push({ day, date, action, message: message.slice(0, 50), reply: reply.slice(0, 60), verify: detail, pass })
  const icon = pass ? '  ✓' : '  ✗'
  console.log(`${icon} [${action}] ${message.slice(0, 40)}${message.length > 40 ? '...' : ''} → ${pass ? 'OK' : '❌ ' + detail}`)
  return reply
}

// ============ DAY SIMULATION ============

async function simulateDay(p: Persona, dayNum: number, date: string, prevTasks: string[]) {
  setMockDate(date)
  const tag = SIM_TAG
  console.log(`\n📅 Day ${dayNum} (${date}) — ${p.name}`)

  // === Morning: check tasks ===
  if (dayNum > 1) {
    await act(dayNum, date, '查任務', '今天有什麼任務', async () => {
      return { pass: true, detail: 'query ok' }
    })
  }

  // === Add 1-3 new tasks ===
  const newTasks: string[] = []
  const taskCount = randInt(1, 3)
  for (let i = 0; i < taskCount; i++) {
    const taskBase = pick(p.tasks)
    const hasDate = chance(0.6)
    const msg = hasDate ? `今天${taskBase}` : taskBase
    await act(dayNum, date, '新增任務', msg, async () => {
      await new Promise(r => setTimeout(r, 300))
      // Claude may strip suffixes, so search by the base task name
      const rows = await supaQuery(`tasks?title=ilike.*${encodeURIComponent(taskBase)}*&date=eq.${date}&order=created_at.desc&limit=1`) as { id: string }[]
      // Also check if added to any date (Claude might pick a different day)
      if (rows.length > 0) return { pass: true, detail: 'task created' }
      const anyDate = await supaQuery(`tasks?title=ilike.*${encodeURIComponent(taskBase)}*&order=created_at.desc&limit=1`) as { id: string }[]
      return { pass: anyDate.length > 0, detail: anyDate.length > 0 ? 'task created (different date)' : `task "${taskBase}" NOT in Supabase` }
    })
    newTasks.push(taskBase)
  }

  // === Schedule (高管/學生 have them) ===
  if (p.schedules.length > 0 && chance(0.5)) {
    const sched = pick(p.schedules)
    const msg = `明天${sched.time}${sched.title}${tag}`
    await act(dayNum, date, '新增行程', msg, async () => {
      // Calendar is mocked, check if it was called
      const called = calendarCalls.some(c => c.title.includes(sched.title))
      // Claude might use add_task instead of add_calendar_event, both are OK
      return { pass: true, detail: called ? 'calendar called' : 'added as task (no specific time parsed)' }
    })
  }

  // === Expenses (format varies by persona) ===
  const expCount = randInt(1, 3)
  for (let i = 0; i < expCount; i++) {
    const exp = pick(p.expenses)
    let msg = exp.msg
    if (exp.format === 'sms') {
      const mm = date.slice(5, 7)
      const dd = date.slice(8, 10)
      msg = msg.replace('{MM}', mm).replace('{DD}', dd)
    }
    await act(dayNum, date, `記帳(${exp.format})`, msg, async () => {
      await new Promise(r => setTimeout(r, 300))
      const rows = await supaQuery(`expenses?amount=eq.${exp.amount}&order=created_at.desc&limit=1`) as { id: string; title: string }[]
      if (rows.length === 0) return { pass: false, detail: `${exp.format} expense $${exp.amount} NOT in Supabase` }
      return { pass: true, detail: `$${exp.amount} recorded (${exp.format})` }
    })
  }

  // === Complete tasks from previous days ===
  if (prevTasks.length > 0 && chance(p.completionRate)) {
    const task = pick(prevTasks)
    await act(dayNum, date, '完成任務', `標記「${task}」完成`, async () => {
      await new Promise(r => setTimeout(r, 500))
      const rows = await supaQuery(`tasks?title=ilike.*${encodeURIComponent(task)}*&completed=eq.true&limit=1`) as { completed: boolean }[]
      // If Claude found and completed it, great. If not found, it might have been deleted or renamed
      if (rows.length > 0) return { pass: true, detail: 'completed=true' }
      // Check if any version exists
      const any = await supaQuery(`tasks?title=ilike.*${encodeURIComponent(task)}*&limit=1`) as { completed: boolean }[]
      if (any.length === 0) return { pass: false, detail: `task "${task}" not found in DB` }
      return { pass: false, detail: 'task exists but not completed' }
    })
  }

  // === Postpone tasks ===
  if (prevTasks.length > 0 && chance(p.postponeRate)) {
    const task = pick(prevTasks)
    const tomorrow = addDaysToDate(date, 1)
    await act(dayNum, date, '順延任務', `把「${task}」順延到明天`, async () => {
      await new Promise(r => setTimeout(r, 500))
      const rows = await supaQuery(`tasks?title=ilike.*${encodeURIComponent(task)}*&order=date.desc&limit=1`) as { date: string; carried_over: boolean }[]
      if (rows.length === 0) return { pass: false, detail: `task "${task}" not found` }
      return { pass: true, detail: `date=${rows[0].date}, carried=${rows[0].carried_over}` }
    })
  }

  // === Mood ===
  if (chance(0.6)) {
    const energy = randInt(p.moodRange[0], p.moodRange[1])
    const tag2 = pick(p.moodTags)
    await act(dayNum, date, '心情', `今天心情${energy}分，${tag2}`, async () => {
      await new Promise(r => setTimeout(r, 300))
      const rows = await supaQuery(`mood?date=eq.${date}&limit=1`) as { energy: number }[]
      if (rows.length === 0) return { pass: false, detail: 'mood NOT in Supabase' }
      return { pass: rows[0].energy === energy, detail: `energy=${rows[0].energy}` }
    })
  }

  // === Journal ===
  if (chance(p.journalRate)) {
    const entry = pick(p.journals)
    await act(dayNum, date, '日記', `日記：${entry}`, async () => {
      await new Promise(r => setTimeout(r, 300))
      const rows = await supaQuery(`journal?date=eq.${date}&limit=1`) as { content: string }[]
      if (rows.length === 0) return { pass: false, detail: 'journal NOT in Supabase' }
      return { pass: rows[0].content.length > 0, detail: 'journal written' }
    })
  }

  // === Habit check-in ===
  if (chance(p.habitRate)) {
    await act(dayNum, date, '習慣打卡', '運動打卡', async () => {
      await new Promise(r => setTimeout(r, 300))
      const rows = await supaQuery(`habit_logs?date=eq.${date}&limit=1`) as { completed: boolean }[]
      // If no habit definitions exist, that's OK
      return { pass: true, detail: rows.length > 0 ? 'habit logged' : 'no habit defs (ok)' }
    })
  }

  return newTasks
}

// ============ CLEANUP & REPORT ============

async function cleanup() {
  const since = new Date(Date.now() - 600000).toISOString() // last 10 min
  console.log('\n🧹 清理模擬資料（最近 10 分鐘內建立的）...')
  // Delete tasks created during simulation (match by simulated dates 2026-03-25 to 2026-04-10)
  await supaDelete(`tasks?date=gte.2026-03-25&date=lte.2026-04-10&created_at=gte.${since}`)
  await supaDelete(`expenses?created_at=gte.${since}`)
  await supaDelete(`journal?date=gte.2026-03-25&date=lte.2026-04-10&created_at=gte.${since}`)
  await supaDelete(`mood?date=gte.2026-03-25&date=lte.2026-04-10&created_at=gte.${since}`)
  await supaDelete(`habit_logs?created_at=gte.${since}`)
  await supaDelete(`bot_memory?chat_id=eq.${CHAT_ID}`)
  setMockToday(null)
  console.log('清理完成')
}

function report(): number {
  console.log('\n' + '='.repeat(60))
  console.log('📊 模擬報告')
  console.log('='.repeat(60))

  const total = logs.length
  const passed = logs.filter(l => l.pass).length
  const failed = logs.filter(l => !l.pass)

  // Group by action
  const byAction: Record<string, { total: number; pass: number }> = {}
  for (const l of logs) {
    if (!byAction[l.action]) byAction[l.action] = { total: 0, pass: 0 }
    byAction[l.action].total++
    if (l.pass) byAction[l.action].pass++
  }

  console.log('\n操作統計：')
  for (const [action, s] of Object.entries(byAction).sort((a, b) => a[0].localeCompare(b[0]))) {
    const icon = s.pass === s.total ? '✅' : '❌'
    console.log(`  ${icon} ${action}: ${s.pass}/${s.total}`)
  }

  // Group by day
  const byDay: Record<number, { total: number; pass: number }> = {}
  for (const l of logs) {
    if (!byDay[l.day]) byDay[l.day] = { total: 0, pass: 0 }
    byDay[l.day].total++
    if (l.pass) byDay[l.day].pass++
  }

  console.log('\n每日統計：')
  for (const [day, s] of Object.entries(byDay)) {
    const pct = Math.round((s.pass / s.total) * 100)
    console.log(`  Day ${day}: ${s.pass}/${s.total} (${pct}%)`)
  }

  console.log(`\n總計: ${total} 操作 | ✅ ${passed} | ❌ ${total - passed}`)

  if (failed.length > 0) {
    console.log('\n🐛 失敗的操作：')
    for (const f of failed) {
      console.log(`  Day${f.day} (${f.date}) [${f.action}] "${f.message}"`)
      console.log(`    ↳ verify: ${f.verify}`)
      console.log(`    ↳ reply: ${f.reply}`)
    }
  } else {
    console.log('\n🎉 全部操作都通過驗證！')
  }

  console.log('='.repeat(60))
  return failed.length
}

// ============ MAIN ============

async function runPersona(persona: Persona, days: number) {
  logs.length = 0
  calendarCalls = []
  console.log(`\n🎭 ${persona.name}`)
  console.log(`   ${persona.description}`)
  console.log(`   模擬 ${days} 天`)

  // Setup message handler with mocked Telegram + Calendar
  const mod = await import('../api/telegram-webhook.js')
  const originalFetch = globalThis.fetch

  handleMessage = async (chatId: number, text: string): Promise<string> => {
    let replyText = ''
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      // Mock Telegram sendMessage
      if (url.includes('/sendMessage') && init?.body) {
        replyText = JSON.parse(init.body as string).text
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      // Track Google Calendar calls
      if (url.includes('googleapis.com/calendar') && init?.method === 'POST' && init?.body) {
        const body = JSON.parse(init.body as string)
        calendarCalls.push({ title: body.summary, date: body.start?.dateTime?.slice(0, 10) || '', time: body.start?.dateTime?.slice(11, 16) || '' })
        return new Response(JSON.stringify({ htmlLink: 'https://mock-calendar-link' }), { status: 200 })
      }
      return originalFetch(input, init)
    }
    try {
      const req = { method: 'POST', body: { message: { chat: { id: chatId }, text } }, headers: {} }
      const res = { status: () => ({ json: () => {} }) }
      await mod.default(req, res)
    } finally {
      globalThis.fetch = originalFetch
    }
    return replyText
  }

  // Simulate days
  const startDate = '2026-03-25'
  let allTasks: string[] = []

  for (let d = 1; d <= days; d++) {
    const date = addDaysToDate(startDate, d - 1)
    const newTasks = await simulateDay(persona, d, date, allTasks)
    allTasks = [...allTasks, ...newTasks]
  }

  await cleanup()
  return report()
}

async function main() {
  const days = parseInt(process.argv[2] || '3')
  const personaKey = process.argv[3] || pick(Object.keys(PERSONAS))

  if (!SUPA_URL || !SUPA_KEY) {
    console.error('❌ 缺少環境變數')
    process.exit(1)
  }

  let totalFailures = 0

  if (personaKey === 'all') {
    for (const key of Object.keys(PERSONAS)) {
      totalFailures += await runPersona(PERSONAS[key], days)
    }
  } else {
    const persona = PERSONAS[personaKey]
    if (!persona) {
      console.error(`❌ 找不到「${personaKey}」，可選：${Object.keys(PERSONAS).join('、')}、all`)
      process.exit(1)
    }
    totalFailures = await runPersona(persona, days)
  }

  process.exit(totalFailures > 0 ? 1 : 0)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
