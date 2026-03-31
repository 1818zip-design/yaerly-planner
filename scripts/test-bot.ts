/**
 * Bot Integration Test - 模擬用戶使用並驗證 Supabase 寫入
 *
 * 用法：npx tsx scripts/test-bot.ts
 *
 * 會自動：
 * 1. 模擬各種用戶操作
 * 2. 驗證 Supabase 有正確寫入
 * 3. 清理測試資料
 * 4. 輸出測試報告
 */

import 'dotenv/config'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SUPA_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const CHAT_ID = parseInt(process.env.TELEGRAM_CHAT_ID || '0')

function supaHeaders() {
  return { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
}

async function supaQuery(path: string) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, { headers: supaHeaders() })
  return res.ok ? res.json() : []
}

async function supaDelete(path: string) {
  await fetch(`${SUPA_URL}/rest/v1/${path}`, { method: 'DELETE', headers: supaHeaders() })
}

// Import the handleMessage function dynamically
let handleMessage: (chatId: number, text: string) => Promise<string>

interface TestResult {
  name: string
  pass: boolean
  reply: string
  error?: string
  duration: number
}

const results: TestResult[] = []
const cleanupIds: { table: string; id: string }[] = []

async function test(name: string, message: string, validate: (reply: string) => Promise<{ pass: boolean; error?: string }>) {
  const start = Date.now()
  try {
    const reply = await handleMessage(CHAT_ID, message)
    const { pass, error } = await validate(reply)
    results.push({ name, pass, reply: reply.slice(0, 100), error, duration: Date.now() - start })
  } catch (err) {
    results.push({ name, pass: false, reply: '', error: String(err).slice(0, 200), duration: Date.now() - start })
  }
}

function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

function tomorrow() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

// ============ TESTS ============

async function testSlashTasks() {
  await test('/tasks 指令', '/tasks', async (reply) => {
    return { pass: reply.includes('任務') || reply.includes('沒有任務'), error: reply.includes('Error') ? reply : undefined }
  })
}

async function testSlashHelp() {
  await test('/help 指令', '/help', async (reply) => {
    return { pass: reply.includes('Planner Bot') }
  })
}

async function testAddTask() {
  const title = `_TEST_任務_${Date.now()}`
  await test('新增任務', `今天${title}`, async (reply) => {
    await new Promise(r => setTimeout(r, 500))
    const tasks = await supaQuery(`tasks?title=ilike.*${encodeURIComponent(title)}*`) as { id: string; date: string }[]
    if (tasks.length === 0) return { pass: false, error: '任務未寫入 Supabase' }
    cleanupIds.push({ table: 'tasks', id: tasks[0].id })
    return { pass: true }
  })
}

async function testAddExpense() {
  await test('記帳', '午餐花了999測試', async (reply) => {
    await new Promise(r => setTimeout(r, 500))
    const expenses = await supaQuery(`expenses?amount=eq.999&order=created_at.desc&limit=1`) as { id: string }[]
    if (expenses.length === 0) return { pass: false, error: '記帳未寫入 Supabase' }
    cleanupIds.push({ table: 'expenses', id: expenses[0].id })
    return { pass: reply.includes('記帳') || reply.includes('999') || reply.includes('午餐') }
  })
}

async function testCreditCardSMS() {
  await test('刷卡簡訊解析', '永豐貴賓您好，您於01/15刷9,999元', async (reply) => {
    await new Promise(r => setTimeout(r, 500))
    const expenses = await supaQuery(`expenses?amount=eq.9999&order=created_at.desc&limit=1`) as { id: string }[]
    if (expenses.length === 0) return { pass: false, error: '刷卡記帳未寫入 Supabase' }
    cleanupIds.push({ table: 'expenses', id: expenses[0].id })
    return { pass: reply.includes('9,999') }
  })
}

async function testApplePay() {
  await test('Apple Pay 解析', '永豐銀行\n測試商家\n$888.00', async (reply) => {
    await new Promise(r => setTimeout(r, 500))
    const expenses = await supaQuery(`expenses?amount=eq.888&order=created_at.desc&limit=1`) as { id: string }[]
    if (expenses.length === 0) return { pass: false, error: 'Apple Pay 記帳未寫入 Supabase' }
    cleanupIds.push({ table: 'expenses', id: expenses[0].id })
    return { pass: reply.includes('888') }
  })
}

async function testAddMood() {
  await test('心情記錄', '今天心情3分，有點焦慮', async (reply) => {
    await new Promise(r => setTimeout(r, 500))
    const moods = await supaQuery(`mood?date=eq.${today()}&order=created_at.desc&limit=1`) as { id: string; energy: number }[]
    if (moods.length === 0) return { pass: false, error: '心情未寫入 Supabase' }
    cleanupIds.push({ table: 'mood', id: moods[0].id })
    return { pass: moods[0].energy === 3 }
  })
}

async function testAddJournal() {
  await test('寫日記', '日記：今天是自動測試日_TEST', async (reply) => {
    await new Promise(r => setTimeout(r, 500))
    const journals = await supaQuery(`journal?date=eq.${today()}&order=created_at.desc&limit=1`) as { id: string; content: string }[]
    if (journals.length === 0) return { pass: false, error: '日記未寫入 Supabase' }
    cleanupIds.push({ table: 'journal', id: journals[0].id })
    return { pass: journals[0].content.includes('自動測試') }
  })
}

async function testCompleteTask() {
  const title = `_TEST_完成_${Date.now()}`
  // Insert directly to be deterministic
  const insertRes = await fetch(`${SUPA_URL}/rest/v1/tasks`, {
    method: 'POST', headers: supaHeaders(),
    body: JSON.stringify({ title, date: today(), time_slot: 'anytime', completed: false, carried_over: false, tags: [], goal_id: null }),
  })
  await new Promise(r => setTimeout(r, 300))

  await test('標記任務完成', `標記「${title}」完成`, async (reply) => {
    await new Promise(r => setTimeout(r, 500))
    const tasks = await supaQuery(`tasks?title=eq.${encodeURIComponent(title)}`) as { id: string; completed: boolean }[]
    if (tasks.length === 0) return { pass: false, error: '找不到測試任務' }
    cleanupIds.push({ table: 'tasks', id: tasks[0].id })
    return { pass: tasks[0].completed === true, error: tasks[0].completed ? undefined : '任務未標記為完成' }
  })
}

async function testGetWeekTasks() {
  await test('查看週行程', '這週有什麼事', async (reply) => {
    return { pass: reply.includes('任務') || reply.includes('概覽') || reply.includes('沒有') || reply.length > 10 }
  })
}

async function testConversationMemory() {
  // Clear memory first
  await supaDelete(`bot_memory?chat_id=eq.${CHAT_ID}`)

  // Round 1: ask tasks
  await handleMessage(CHAT_ID, '今天有什麼任務')
  await new Promise(r => setTimeout(r, 500))

  // Round 2: context-dependent reply
  await test('對話記憶', '第一個呢', async (reply) => {
    // Should understand "第一個" refers to the first task from previous message
    const memory = await supaQuery(`bot_memory?chat_id=eq.${CHAT_ID}`) as { messages: unknown[] }[]
    if (memory.length === 0) return { pass: false, error: '對話記憶未寫入 bot_memory' }
    return { pass: memory[0].messages.length >= 2, error: memory[0].messages.length < 2 ? '記憶不足 2 筆' : undefined }
  })
}

async function testPostponeTask() {
  const title = `_TEST_順延_${Date.now()}`
  // Insert directly to today to be deterministic
  const insertRes = await fetch(`${SUPA_URL}/rest/v1/tasks`, {
    method: 'POST', headers: supaHeaders(),
    body: JSON.stringify({ title, date: today(), time_slot: 'anytime', completed: false, carried_over: false, tags: [], goal_id: null }),
  })
  const inserted = await insertRes.json()
  const taskId = Array.isArray(inserted) ? inserted[0]?.id : (inserted as { id: string }).id
  await new Promise(r => setTimeout(r, 500))

  await test('順延任務', `把「${title}」順延到明天`, async (reply) => {
    await new Promise(r => setTimeout(r, 500))
    const tasks = await supaQuery(`tasks?title=ilike.*${encodeURIComponent(title)}*`) as { id: string; date: string; carried_over: boolean }[]
    if (tasks.length === 0) return { pass: false, error: '找不到順延的任務' }
    // Clean up all copies
    for (const t of tasks) cleanupIds.push({ table: 'tasks', id: t.id })
    const postponed = tasks.find(t => t.date === tomorrow())
    return { pass: !!postponed, error: postponed ? undefined : `沒有找到明天 ${tomorrow()} 的任務，現有日期: ${tasks.map(t => t.date).join(',')}` }
  })
}

async function testHabitCheckin() {
  await test('習慣打卡', '運動打卡', async (reply) => {
    await new Promise(r => setTimeout(r, 500))
    const logs = await supaQuery(`habit_logs?date=eq.${today()}&order=created_at.desc&limit=1`) as { id: string; completed: boolean }[]
    if (logs.length === 0) {
      // If no habit definitions exist, Claude should say so
      return { pass: reply.includes('沒有') || reply.includes('定義') || reply.includes('習慣'), error: logs.length === 0 ? '可能沒有習慣定義' : undefined }
    }
    cleanupIds.push({ table: 'habit_logs', id: logs[0].id })
    return { pass: logs[0].completed === true }
  })
}

async function testDeleteTask() {
  const title = `_TEST_刪除_${Date.now()}`
  await handleMessage(CHAT_ID, `今天${title}`)
  await new Promise(r => setTimeout(r, 1000))

  await test('刪除任務', `刪掉「${title}」`, async (reply) => {
    await new Promise(r => setTimeout(r, 500))
    const tasks = await supaQuery(`tasks?title=eq.${encodeURIComponent(title)}`) as { id: string }[]
    // Task should be deleted
    if (tasks.length > 0) {
      cleanupIds.push({ table: 'tasks', id: tasks[0].id })
      return { pass: false, error: '任務未被刪除' }
    }
    return { pass: true }
  })
}

async function testMultipleTasks() {
  await test('多任務一次新增', '明天要買蘋果、買香蕉、買西瓜_TEST', async (reply) => {
    await new Promise(r => setTimeout(r, 500))
    const tasks = await supaQuery(`tasks?title=ilike.*_TEST*&order=created_at.desc&limit=5`) as { id: string; title: string }[]
    // Should have created multiple tasks
    const testTasks = tasks.filter(t => t.title.includes('_TEST'))
    for (const t of testTasks) cleanupIds.push({ table: 'tasks', id: t.id })
    return { pass: testTasks.length >= 2, error: testTasks.length < 2 ? `只新增了 ${testTasks.length} 筆，預期至少 2 筆` : undefined }
  })
}

async function testSlashDone() {
  const title = `_TEST_DONE_${Date.now()}`
  // Insert directly to today
  await fetch(`${SUPA_URL}/rest/v1/tasks`, {
    method: 'POST', headers: supaHeaders(),
    body: JSON.stringify({ title, date: today(), time_slot: 'anytime', completed: false, carried_over: false, tags: [], goal_id: null }),
  })
  await new Promise(r => setTimeout(r, 300))

  // Get fresh index
  const allTasks = await supaQuery(`tasks?date=eq.${today()}&order=created_at`) as { id: string; title: string }[]
  const idx = allTasks.findIndex(t => t.title === title) + 1
  if (idx === 0) { results.push({ name: '/done N 完成', pass: false, reply: '', error: '插入任務失敗', duration: 0 }); return }

  await test('/done N 完成', `/done ${idx}`, async (reply) => {
    await new Promise(r => setTimeout(r, 300))
    const tasks = await supaQuery(`tasks?title=eq.${encodeURIComponent(title)}`) as { id: string; completed: boolean }[]
    if (tasks.length === 0) return { pass: false, error: '找不到任務' }
    cleanupIds.push({ table: 'tasks', id: tasks[0].id })
    return { pass: tasks[0].completed === true, error: tasks[0].completed ? undefined : '/done 沒有標記完成' }
  })
}

async function testSlashUndo() {
  const title = `_TEST_UNDO_${Date.now()}`
  // Insert as completed
  await fetch(`${SUPA_URL}/rest/v1/tasks`, {
    method: 'POST', headers: supaHeaders(),
    body: JSON.stringify({ title, date: today(), time_slot: 'anytime', completed: true, carried_over: false, tags: [], goal_id: null }),
  })
  await new Promise(r => setTimeout(r, 300))

  const allTasks = await supaQuery(`tasks?date=eq.${today()}&order=created_at`) as { id: string; title: string }[]
  const idx = allTasks.findIndex(t => t.title === title) + 1
  if (idx === 0) { results.push({ name: '/undo N 取消完成', pass: false, reply: '', error: '插入任務失敗', duration: 0 }); return }

  await test('/undo N 取消完成', `/undo ${idx}`, async (reply) => {
    await new Promise(r => setTimeout(r, 300))
    const tasks = await supaQuery(`tasks?title=eq.${encodeURIComponent(title)}`) as { id: string; completed: boolean }[]
    if (tasks.length === 0) return { pass: false, error: '找不到任務' }
    cleanupIds.push({ table: 'tasks', id: tasks[0].id })
    return { pass: tasks[0].completed === false, error: tasks[0].completed ? '/undo 沒有取消完成' : undefined }
  })
}

async function testSlashDel() {
  const title = `_TEST_DEL_${Date.now()}`
  await fetch(`${SUPA_URL}/rest/v1/tasks`, {
    method: 'POST', headers: supaHeaders(),
    body: JSON.stringify({ title, date: today(), time_slot: 'anytime', completed: false, carried_over: false, tags: [], goal_id: null }),
  })
  await new Promise(r => setTimeout(r, 300))

  const allTasks = await supaQuery(`tasks?date=eq.${today()}&order=created_at`) as { id: string; title: string }[]
  const idx = allTasks.findIndex(t => t.title === title) + 1
  if (idx === 0) { results.push({ name: '/del N 刪除', pass: false, reply: '', error: '插入任務失敗', duration: 0 }); return }

  await test('/del N 刪除', `/del ${idx}`, async (reply) => {
    await new Promise(r => setTimeout(r, 300))
    const tasks = await supaQuery(`tasks?title=eq.${encodeURIComponent(title)}`) as { id: string }[]
    if (tasks.length > 0) {
      cleanupIds.push({ table: 'tasks', id: tasks[0].id })
      return { pass: false, error: '/del 沒有刪除任務' }
    }
    return { pass: reply.includes('刪除') }
  })
}

async function testOverdueTasks() {
  // Create a task in the past, then check if get_week_tasks shows it
  const title = `_TEST_過期_${Date.now()}`
  // Insert directly into Supabase with a past date
  const pastDate = '2026-03-20'
  const insertRes = await fetch(`${SUPA_URL}/rest/v1/tasks`, {
    method: 'POST',
    headers: supaHeaders(),
    body: JSON.stringify({ title, date: pastDate, time_slot: 'anytime', completed: false, carried_over: false, tags: [], goal_id: null }),
  })
  const inserted = await insertRes.json() as { id: string }[]
  const taskId = Array.isArray(inserted) ? inserted[0]?.id : (inserted as { id: string }).id
  if (taskId) cleanupIds.push({ table: 'tasks', id: taskId })

  await test('過期任務查詢', '幫我列出所有未完成的任務', async (reply) => {
    // Check Supabase directly: the overdue task should still exist
    const tasks = await supaQuery(`tasks?title=eq.${encodeURIComponent(title)}&completed=eq.false`) as { id: string }[]
    return { pass: tasks.length > 0, error: tasks.length === 0 ? '過期任務被意外刪除' : undefined }
  })
}

async function testGoalCRUD() {
  await test('新增年度目標', '新增目標：TEST自動測試目標', async (reply) => {
    await new Promise(r => setTimeout(r, 500))
    const goals = await supaQuery(`goals?title=ilike.*TEST自動測試*&limit=1`) as { id: string; title: string }[]
    if (goals.length === 0) return { pass: false, error: '目標未寫入 Supabase' }
    cleanupIds.push({ table: 'goals', id: goals[0].id })
    return { pass: true }
  })
}

// ============ CLEANUP & REPORT ============

async function cleanup() {
  console.log(`\n🧹 清理 ${cleanupIds.length} 筆測試資料...`)
  for (const { table, id } of cleanupIds) {
    await supaDelete(`${table}?id=eq.${id}`)
  }
  // Clear test memory
  await supaDelete(`bot_memory?chat_id=eq.${CHAT_ID}`)
  console.log('清理完成')
}

function report() {
  console.log('\n' + '='.repeat(60))
  console.log('📊 測試報告')
  console.log('='.repeat(60))

  const passed = results.filter(r => r.pass)
  const failed = results.filter(r => !r.pass)

  for (const r of results) {
    const icon = r.pass ? '✅' : '❌'
    const time = `${r.duration}ms`
    console.log(`${icon} ${r.name} (${time})`)
    if (r.error) console.log(`   ↳ ${r.error}`)
    if (!r.pass && r.reply) console.log(`   ↳ Reply: ${r.reply}`)
  }

  console.log('\n' + '-'.repeat(60))
  console.log(`Total: ${results.length} | ✅ ${passed.length} | ❌ ${failed.length}`)

  if (failed.length > 0) {
    console.log('\n🐛 失敗的測試需要修復：')
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.error || f.reply}`)
    }
  } else {
    console.log('\n🎉 全部通過！')
  }

  console.log('='.repeat(60))
  return failed.length
}

// ============ MAIN ============

async function main() {
  console.log('🚀 開始 Bot 整合測試...')
  console.log(`   Supabase: ${SUPA_URL ? '✓' : '✗'}`)
  console.log(`   Chat ID: ${CHAT_ID}`)
  console.log('')

  if (!SUPA_URL || !SUPA_KEY) {
    console.error('❌ 缺少 SUPABASE_URL 或 SUPABASE_ANON_KEY')
    process.exit(1)
  }

  // Dynamic import to load the handler
  const mod = await import('../api/telegram-webhook.js')
  // The handleMessage isn't exported, so we simulate via the handler
  // Actually, let's import it differently - we need to access internal functions
  // Workaround: use the CLI test approach
  const { env } = await import('../api/lib/helpers.js')

  // We need to construct a way to call handleMessage
  // Since it's not exported, let's test via HTTP simulation
  // Actually the cleanest way: import the pieces directly

  const { fetchTasksByDate } = await import('../api/lib/supabase-ops.js')
  const { getHistory } = await import('../api/lib/memory.js')

  // For the actual message handling, we'll call the webhook handler with a fake req/res
  async function simulateMessage(text: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = {
        method: 'POST',
        body: { message: { chat: { id: CHAT_ID }, text } },
        headers: {},
      }
      let responseBody = ''
      const res = {
        status: () => ({
          json: (data: unknown) => { responseBody = JSON.stringify(data) },
        }),
      }
      mod.default(req, res).then(() => {
        // The reply was sent via Telegram API, we can't capture it directly
        // Instead, just check if it succeeded
        resolve(responseBody)
      }).catch(reject)
    })
  }

  // Better approach: directly test the bot logic by importing pieces
  // and testing the Supabase results

  // Override handleMessage to use our webhook handler
  handleMessage = async (chatId: number, text: string): Promise<string> => {
    // Call webhook handler with fake request
    let replyText = ''

    // Monkey-patch global fetch to capture the Telegram sendMessage call
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      if (url.includes('/sendMessage') && init?.body) {
        const body = JSON.parse(init.body as string)
        replyText = body.text
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      return originalFetch(input, init)
    }

    try {
      const req = { method: 'POST', body: { message: { chat: { id: chatId }, text } }, headers: {} }
      const res = { status: (_code: number) => ({ json: (_data: unknown) => {} }) }
      await mod.default(req, res)
    } finally {
      globalThis.fetch = originalFetch
    }

    return replyText
  }

  // Run all tests
  await testSlashHelp()
  await testSlashTasks()
  await testAddTask()
  await testAddExpense()
  await testCreditCardSMS()
  await testApplePay()
  await testAddMood()
  await testAddJournal()
  await testCompleteTask()
  await testPostponeTask()
  await testDeleteTask()
  await testMultipleTasks()
  await testSlashDone()
  await testSlashUndo()
  await testSlashDel()
  await testHabitCheckin()
  await testGoalCRUD()
  await testOverdueTasks()
  await testGetWeekTasks()
  await testConversationMemory()

  // Cleanup & report
  await cleanup()
  const failures = report()

  process.exit(failures > 0 ? 1 : 0)
}

main().catch(e => {
  console.error('Fatal error:', e)
  process.exit(1)
})
