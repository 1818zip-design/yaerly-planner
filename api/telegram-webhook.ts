/**
 * Telegram Webhook - AI-powered task assistant
 *
 * Slash commands (handled directly, no AI):
 *   /tasks        → List today's tasks
 *   /done N       → Mark task #N as completed
 *   /undo N       → Undo task #N
 *   /del N        → Delete task #N
 *   /help         → Show commands
 *
 * Natural language (handled by Claude):
 *   "幫我排下週三要做的事" → AI reads your schedule, suggests a date, confirms, then adds
 *   "明天有什麼事" → AI fetches and summarizes
 *   Any other text → AI decides whether to add task, query data, or chat
 *
 * Setup:
 *   1. Deploy to Vercel
 *   2. Set env vars: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ANTHROPIC_API_KEY,
 *      VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
 *      GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
 *      GOOGLE_CALENDAR_ID (optional, defaults to 'primary')
 *   3. Register webhook:
 *      curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<domain>/api/telegram-webhook"
 */

import Anthropic from '@anthropic-ai/sdk'

// --- Types ---
interface TelegramUpdate {
  message?: {
    chat: { id: number }
    text?: string
  }
}

interface Task {
  id: string
  title: string
  completed: boolean
  date: string
  carried_over: boolean
  tags: string[]
  goal_id: string | null
}

interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

// --- Conversation memory (in-process, per chat) ---
const conversationStore = new Map<number, ConversationMessage[]>()
const MAX_HISTORY = 5

function getHistory(chatId: number): ConversationMessage[] {
  return conversationStore.get(chatId) || []
}

function pushHistory(chatId: number, role: 'user' | 'assistant', content: string) {
  const history = getHistory(chatId)
  history.push({ role, content })
  // Keep last N pairs (N user + N assistant = 2N messages)
  while (history.length > MAX_HISTORY * 2) history.shift()
  conversationStore.set(chatId, history)
}

// --- Helpers ---
function env(key: string): string {
  return process.env[key] || ''
}

function getTodayTaipei(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

function addDaysToDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00+08:00')
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

function supabaseHeaders() {
  const key = env('VITE_SUPABASE_ANON_KEY')
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
}

function supabaseUrl(path: string): string {
  return `${env('VITE_SUPABASE_URL')}/rest/v1/${path}`
}

async function sendTelegram(chatId: number, text: string): Promise<void> {
  // Telegram has a 4096 char limit
  const truncated = text.length > 4000 ? text.slice(0, 4000) + '...' : text
  await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: truncated, parse_mode: 'HTML' }),
  })
}

// --- Google Calendar operations ---
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

interface CalendarEventInput {
  title: string
  date: string        // YYYY-MM-DD
  start_time: string  // HH:mm
  end_time?: string   // HH:mm (optional, defaults to start_time + 1hr)
  location?: string
}

async function createCalendarEvent(input: CalendarEventInput): Promise<string> {
  const accessToken = await getGoogleAccessToken()
  if (!accessToken) return '❌ Google Calendar 未設定（缺少 OAuth 憑證）'

  const calendarId = env('GOOGLE_CALENDAR_ID') || 'primary'
  const { title, date, start_time, location } = input

  // Calculate end time (default +1hr)
  let endTime = input.end_time
  if (!endTime) {
    const [h, m] = start_time.split(':').map(Number)
    endTime = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  const event = {
    summary: title,
    start: {
      dateTime: `${date}T${start_time}:00`,
      timeZone: 'Asia/Taipei',
    },
    end: {
      dateTime: `${date}T${endTime}:00`,
      timeZone: 'Asia/Taipei',
    },
    ...(location ? { location } : {}),
  }

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
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

// --- Supabase task operations ---
async function fetchTasksByDate(date: string): Promise<Task[]> {
  const res = await fetch(supabaseUrl(`tasks?date=eq.${date}&order=created_at`), {
    headers: supabaseHeaders(),
  })
  if (!res.ok) return []
  return res.json()
}

async function fetchTasksRange(startDate: string, endDate: string): Promise<Task[]> {
  const res = await fetch(
    supabaseUrl(`tasks?date=gte.${startDate}&date=lte.${endDate}&order=date,created_at`),
    { headers: supabaseHeaders() },
  )
  if (!res.ok) return []
  return res.json()
}

async function addTaskToDate(date: string, title: string): Promise<Task | null> {
  const url = supabaseUrl('tasks')
  const body = {
    title, date, time_slot: 'anytime',
    completed: false, carried_over: false, tags: [], goal_id: null,
  }
  console.log('[addTaskToDate] Inserting:', JSON.stringify(body))
  const res = await fetch(url, {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text()
    console.error('[addTaskToDate] Failed:', res.status, errText)
    return null
  }
  const data = await res.json()
  const task = Array.isArray(data) ? data[0] : data
  console.log('[addTaskToDate] Success:', task?.id, task?.title)
  return task
}

async function updateTask(id: string, updates: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(supabaseUrl(`tasks?id=eq.${id}`), {
    method: 'PATCH',
    headers: supabaseHeaders(),
    body: JSON.stringify(updates),
  })
  return res.ok
}

async function deleteTaskById(id: string): Promise<boolean> {
  const res = await fetch(supabaseUrl(`tasks?id=eq.${id}`), {
    method: 'DELETE',
    headers: supabaseHeaders(),
  })
  return res.ok
}

// --- Format helpers ---
function formatTaskList(tasks: Task[], date: string): string {
  if (tasks.length === 0) return `📭 ${date} 沒有任務`
  const done = tasks.filter(t => t.completed).length
  const lines = tasks.map((t, i) => {
    const check = t.completed ? '✅' : '⬜'
    const carry = t.carried_over ? ' ↻' : ''
    const strike = t.completed ? `<s>${t.title}</s>` : t.title
    return `${check} ${i + 1}. ${strike}${carry}`
  })
  return [`📋 <b>任務</b>（${date}）`, `${done}/${tasks.length} 完成`, '', ...lines].join('\n')
}

// --- Claude AI tool definitions ---
const CLAUDE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_tasks',
    description: '取得指定日期的任務列表。回傳該天所有任務，包含完成狀態。',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: '日期，格式 YYYY-MM-DD' },
      },
      required: ['date'],
    },
  },
  {
    name: 'get_week_tasks',
    description: '取得今天起未來 7 天的所有任務。用來查看哪天比較空、安排新任務。',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'add_task',
    description: '新增一筆待辦任務到 Supabase（沒有明確時間點的事項）。例如：買東西、完成報告、訂票。簡單明確的任務可以直接新增，不需等確認。',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: '日期，格式 YYYY-MM-DD' },
        title: { type: 'string', description: '任務名稱' },
      },
      required: ['date', 'title'],
    },
  },
  {
    name: 'add_calendar_event',
    description: '新增一筆行程到 Google Calendar（有明確時間點的事項）。例如：開會、看醫生、搭車。用戶已給出明確時間時可以直接新增。',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: '日期，格式 YYYY-MM-DD' },
        title: { type: 'string', description: '行程名稱' },
        start_time: { type: 'string', description: '開始時間，格式 HH:mm（24小時制）' },
        end_time: { type: 'string', description: '結束時間，格式 HH:mm（選填，預設為開始時間 +1 小時）' },
        location: { type: 'string', description: '地點（選填）' },
      },
      required: ['date', 'title', 'start_time'],
    },
  },
]

const SYSTEM_PROMPT = `你是用戶的貼心行程助理，說話簡潔自然，不說多餘的鼓勵語。
你可以讀取用戶的任務資料來回答問題和安排行程。
回覆用繁體中文，語氣像朋友。

當用戶要安排某件事時，你必須先判斷這是「行程」還是「任務」：

📅 行程（有明確時間點）→ 用 add_calendar_event 加到 Google Calendar
  判斷條件：用戶提到了具體時間（幾點、上午/下午幾點、早上9點等）
  例如：「明天下午3點開會」「週五10點看牙醫」「4月8日下午2點搭高鐵回台中」
  回覆時要說明：「這是行程，我幫你加到 Google Calendar」

✅ 任務（待辦事項）→ 用 add_task 加到待辦清單
  判斷條件：只有日期或「這週」「明天」但沒有具體時間
  例如：「買咖啡機膠囊」「完成履歷」「訂高鐵票」「明天要寄包裹」
  回覆時要說明：「這是待辦事項，我幫你加到待辦清單」

⚠️ 不確定時 → 預設加到待辦清單（add_task），並告訴用戶：
  「我先幫你加到待辦清單，如果需要設定提醒時間再告訴我，我可以幫你加到 Google Calendar」

流程分兩種：

1. 簡單明確的事項（用戶說了要做什麼，不需要選日期）：
   直接加到今天（或用戶指定的日期），不需要等確認。加完後告訴用戶結果。
   例如：「買牛奶」→ 直接呼叫 add_task 加到今天
   例如：「明天下午3點開會」→ 直接呼叫 add_calendar_event
   重要：你必須真的呼叫 add_task 或 add_calendar_event 工具，不能只用文字回覆說已新增。

2. 需要建議日期的事項（用戶沒指定日期，或說「幫我排」「找個時間」）：
   先用 get_week_tasks 查看未來幾天，選最空的一天，告訴用戶建議並說明原因，等確認後才新增。
   確認的方式：用戶說「好」、「可以」、「就這樣」之類的就算確認。
今天是 ${getTodayTaipei()}。
回覆不要用 markdown 格式（不要用 **粗體** 或 # 標題），因為是 Telegram 訊息。
如果需要強調可以用 emoji 或直接用文字表達。`

// --- Execute a tool call ---
async function executeTool(name: string, input: Record<string, string>): Promise<string> {
  switch (name) {
    case 'get_tasks': {
      const tasks = await fetchTasksByDate(input.date)
      if (tasks.length === 0) return `${input.date} 沒有任何任務。`
      const lines = tasks.map((t, i) =>
        `${i + 1}. [${t.completed ? '完成' : '未完成'}] ${t.title}${t.carried_over ? '（順延）' : ''}`
      )
      return `${input.date} 的任務（共 ${tasks.length} 筆）：\n${lines.join('\n')}`
    }
    case 'get_week_tasks': {
      const today = getTodayTaipei()
      const endDate = addDaysToDate(today, 6)
      const tasks = await fetchTasksRange(today, endDate)
      const byDate: Record<string, Task[]> = {}
      for (let i = 0; i < 7; i++) {
        const d = addDaysToDate(today, i)
        byDate[d] = []
      }
      for (const t of tasks) {
        if (byDate[t.date]) byDate[t.date].push(t)
      }
      const lines = Object.entries(byDate).map(([date, tasks]) => {
        const dayOfWeek = new Date(date + 'T00:00:00+08:00')
          .toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', weekday: 'short' })
        const incomplete = tasks.filter(t => !t.completed).length
        const taskNames = tasks.map(t => `  - [${t.completed ? '✓' : ' '}] ${t.title}`).join('\n')
        return `${date}（${dayOfWeek}）：${tasks.length} 筆任務，${incomplete} 筆未完成${taskNames ? '\n' + taskNames : ''}`
      })
      return `未來 7 天任務概覽：\n${lines.join('\n')}`
    }
    case 'add_task': {
      console.log('[executeTool] add_task called:', input.date, input.title)
      const task = await addTaskToDate(input.date, input.title)
      if (!task) {
        console.error('[executeTool] add_task failed for:', input.title)
        return '新增失敗，Supabase 寫入錯誤'
      }
      console.log('[executeTool] add_task success, id:', task.id)
      return `已成功新增待辦任務「${input.title}」到 ${input.date}，task id: ${task.id}`
    }
    case 'add_calendar_event': {
      const result = await createCalendarEvent({
        title: input.title,
        date: input.date,
        start_time: input.start_time,
        end_time: input.end_time,
        location: input.location,
      })
      return result
    }
    default:
      return `未知工具：${name}`
  }
}

// --- Claude AI conversation ---
async function chatWithClaude(chatId: number, userMessage: string): Promise<string> {
  const apiKey = env('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return '⚠️ AI 助理未設定（缺少 ANTHROPIC_API_KEY）\n直接輸入文字會新增為今天的任務'
  }

  const client = new Anthropic({ apiKey })
  const history = getHistory(chatId)

  const messages: Anthropic.MessageParam[] = [
    ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: userMessage },
  ]

  try {
    let response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: CLAUDE_TOOLS,
      messages,
    })

    // Handle tool use loop
    let iterations = 0
    while (response.stop_reason === 'tool_use' && iterations < 5) {
      iterations++
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      )

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const toolUse of toolUseBlocks) {
        const result = await executeTool(toolUse.name, toolUse.input as Record<string, string>)
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: result })
      }

      messages.push({ role: 'assistant', content: response.content })
      messages.push({ role: 'user', content: toolResults })

      response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: CLAUDE_TOOLS,
        messages,
      })
    }

    // Extract final text
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    )
    const reply = textBlocks.map(b => b.text).join('\n') || '（無回覆）'

    pushHistory(chatId, 'user', userMessage)
    pushHistory(chatId, 'assistant', reply)

    return reply
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('credit balance') || msg.includes('billing')) {
      return '⚠️ Claude API 額度不足，請到 console.anthropic.com 加值'
    }
    if (msg.includes('authentication') || msg.includes('api-key') || msg.includes('401')) {
      return '⚠️ Claude API Key 無效，請檢查 ANTHROPIC_API_KEY 設定'
    }
    console.error('[chatWithClaude] Error:', err)
    return `⚠️ AI 暫時無法回應：${msg.slice(0, 100)}`
  }
}

// --- Direct command handlers (no AI) ---
async function handleDirectCommand(chatId: number, text: string): Promise<string | null> {
  const trimmed = text.trim()

  if (trimmed === '/help' || trimmed === '/start') {
    return [
      '🗓 <b>Planner Bot</b>',
      '',
      '💬 直接輸入自然語言 → AI 助理幫你安排',
      '',
      '<b>快捷指令：</b>',
      '/tasks → 查看今日任務',
      '/done N → 完成第 N 筆任務',
      '/undo N → 取消完成第 N 筆',
      '/del N → 刪除第 N 筆任務',
      '/help → 顯示此說明',
    ].join('\n')
  }

  if (trimmed === '/tasks') {
    const today = getTodayTaipei()
    const tasks = await fetchTasksByDate(today)
    return formatTaskList(tasks, today)
  }

  const doneMatch = trimmed.match(/^\/done\s+(\d+)$/)
  if (doneMatch) {
    const n = parseInt(doneMatch[1])
    const tasks = await fetchTasksByDate(getTodayTaipei())
    if (n < 1 || n > tasks.length) return `❌ 無效編號，今天共 ${tasks.length} 筆任務`
    const task = tasks[n - 1]
    if (task.completed) return `已經完成了：${task.title}`
    await updateTask(task.id, { completed: true })
    return `✅ 完成：${task.title}`
  }

  const undoMatch = trimmed.match(/^\/undo\s+(\d+)$/)
  if (undoMatch) {
    const n = parseInt(undoMatch[1])
    const tasks = await fetchTasksByDate(getTodayTaipei())
    if (n < 1 || n > tasks.length) return `❌ 無效編號，今天共 ${tasks.length} 筆任務`
    const task = tasks[n - 1]
    if (!task.completed) return `還沒完成：${task.title}`
    await updateTask(task.id, { completed: false })
    return `↩️ 已取消完成：${task.title}`
  }

  const delMatch = trimmed.match(/^\/del\s+(\d+)$/)
  if (delMatch) {
    const n = parseInt(delMatch[1])
    const tasks = await fetchTasksByDate(getTodayTaipei())
    if (n < 1 || n > tasks.length) return `❌ 無效編號，今天共 ${tasks.length} 筆任務`
    const task = tasks[n - 1]
    await deleteTaskById(task.id)
    return `🗑 已刪除：${task.title}`
  }

  // Unknown slash command
  if (trimmed.startsWith('/')) {
    return '❓ 未知指令，輸入 /help 查看可用指令'
  }

  // Not a command → return null to signal AI handling
  return null
}

// --- Main handler ---
async function handleMessage(chatId: number, text: string): Promise<string> {
  const allowedChat = env('TELEGRAM_CHAT_ID')
  if (allowedChat && String(chatId) !== allowedChat) {
    return '⛔ 未授權的使用者'
  }

  // Try direct commands first
  const directResult = await handleDirectCommand(chatId, text)
  if (directResult !== null) return directResult

  // Natural language → Claude AI
  return chatWithClaude(chatId, text)
}

// --- Vercel Serverless Function handler ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, method: req.method })
  }

  try {
    const update: TelegramUpdate = req.body
    const chatId = update.message?.chat?.id
    const text = update.message?.text

    if (!chatId || !text) {
      return res.status(200).json({ ok: true, skip: 'no text message' })
    }

    const reply = await handleMessage(chatId, text)
    await sendTelegram(chatId, reply)
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[telegram-webhook] Error:', err)
    return res.status(200).json({ ok: true, error: String(err) })
  }
}

// --- CLI test mode ---
if (process.argv[1]?.includes('telegram-webhook')) {
  await import('dotenv/config')
  const testMsg = process.argv[2] || '/tasks'
  const chatId = parseInt(env('TELEGRAM_CHAT_ID'))
  console.log(`[test] Message: "${testMsg}"`)
  const reply = await handleMessage(chatId, testMsg)
  console.log(`[test] Reply:\n${reply}`)
  await sendTelegram(chatId, reply)
  console.log('[test] Sent to Telegram')
  process.exit(0)
}
