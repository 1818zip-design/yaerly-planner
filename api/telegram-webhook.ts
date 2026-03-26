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
 *      SUPABASE_URL, SUPABASE_ANON_KEY,
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

// --- Conversation memory (Supabase-backed, per chat) ---
const MAX_HISTORY = 5

async function getHistory(chatId: number): Promise<ConversationMessage[]> {
  try {
    const res = await fetch(
      supabaseUrl(`bot_memory?chat_id=eq.${chatId}`),
      { headers: supabaseHeaders() },
    )
    if (!res.ok) return []
    const rows = await res.json() as { messages: ConversationMessage[] }[]
    return rows.length > 0 ? (rows[0].messages || []) : []
  } catch {
    return []
  }
}

async function pushHistory(chatId: number, role: 'user' | 'assistant', content: string) {
  try {
    const history = await getHistory(chatId)
    history.push({ role, content })
    while (history.length > MAX_HISTORY * 2) history.shift()

    // Upsert: try update first, then insert
    const body = { chat_id: chatId, messages: history, updated_at: new Date().toISOString() }
    const updateRes = await fetch(
      supabaseUrl(`bot_memory?chat_id=eq.${chatId}`),
      { method: 'PATCH', headers: supabaseHeaders(), body: JSON.stringify({ messages: history, updated_at: body.updated_at }) },
    )
    if (updateRes.ok) {
      const updated = await updateRes.json()
      if (Array.isArray(updated) && updated.length > 0) return
    }
    // Row doesn't exist, insert
    await fetch(supabaseUrl('bot_memory'), {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error('[pushHistory] Error:', err)
  }
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

async function deleteTasksByFilter(date: string, titleMatch?: string): Promise<number> {
  let query = `tasks?date=eq.${date}`
  if (titleMatch) query += `&title=ilike.*${encodeURIComponent(titleMatch)}*`
  const res = await fetch(supabaseUrl(query), {
    method: 'DELETE',
    headers: { ...supabaseHeaders(), Prefer: 'return=representation' },
  })
  if (!res.ok) return 0
  const data = await res.json()
  return Array.isArray(data) ? data.length : 0
}

// --- Supabase: generic delete by table + date ---
async function deleteByDateAndTable(table: string, date: string, titleField?: string, titleMatch?: string): Promise<number> {
  let query = `${table}?date=eq.${date}`
  if (titleField && titleMatch) query += `&${titleField}=ilike.*${encodeURIComponent(titleMatch)}*`
  console.log('[delete]', table, query)
  const res = await fetch(supabaseUrl(query), {
    method: 'DELETE',
    headers: { ...supabaseHeaders(), Prefer: 'return=representation' },
  })
  if (!res.ok) {
    console.error('[delete] Failed:', res.status, await res.text())
    return 0
  }
  const data = await res.json()
  return Array.isArray(data) ? data.length : 0
}

// --- Supabase: expenses ---
async function addExpense(date: string, title: string, amount: number, category: string, note: string): Promise<string> {
  const body = { date, title, amount, category, note }
  console.log('[addExpense] Inserting:', JSON.stringify(body))
  const res = await fetch(supabaseUrl('expenses'), {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    console.error('[addExpense] Failed:', res.status, await res.text())
    return '寫入失敗'
  }
  const data = await res.json()
  const row = Array.isArray(data) ? data[0] : data
  console.log('[addExpense] Success:', row?.id)
  return `已記帳「${title}」${amount} 元（${category}）到 ${date}`
}

// --- Supabase: habit_definitions + habit_logs ---
async function fetchHabitDefinitions(): Promise<{ id: string; name: string }[]> {
  const res = await fetch(supabaseUrl('habit_definitions?order=created_at'), { headers: supabaseHeaders() })
  if (!res.ok) return []
  return res.json()
}

async function addHabitLog(date: string, habitId: string, habitName: string): Promise<string> {
  // upsert: if already logged today, update
  const existing = await fetch(supabaseUrl(`habit_logs?date=eq.${date}&habit_id=eq.${habitId}`), { headers: supabaseHeaders() })
  if (existing.ok) {
    const rows = await existing.json()
    if (Array.isArray(rows) && rows.length > 0) {
      await fetch(supabaseUrl(`habit_logs?id=eq.${rows[0].id}`), {
        method: 'PATCH',
        headers: supabaseHeaders(),
        body: JSON.stringify({ completed: true }),
      })
      return `「${habitName}」今天已打卡（更新）`
    }
  }
  const res = await fetch(supabaseUrl('habit_logs'), {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify({ date, habit_id: habitId, completed: true, note: '' }),
  })
  if (!res.ok) {
    console.error('[addHabitLog] Failed:', res.status, await res.text())
    return '打卡失敗'
  }
  console.log('[addHabitLog] Success:', habitName, date)
  return `「${habitName}」打卡完成（${date}）`
}

// --- Supabase: journal ---
async function upsertJournal(date: string, content: string): Promise<string> {
  const now = new Date().toISOString()
  const existing = await fetch(supabaseUrl(`journal?date=eq.${date}`), { headers: supabaseHeaders() })
  if (existing.ok) {
    const rows = await existing.json()
    if (Array.isArray(rows) && rows.length > 0) {
      await fetch(supabaseUrl(`journal?id=eq.${rows[0].id}`), {
        method: 'PATCH',
        headers: supabaseHeaders(),
        body: JSON.stringify({ content, updated_at: now }),
      })
      return `已更新 ${date} 的日記`
    }
  }
  const res = await fetch(supabaseUrl('journal'), {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify({ date, content, updated_at: now }),
  })
  if (!res.ok) {
    console.error('[upsertJournal] Failed:', res.status, await res.text())
    return '日記寫入失敗'
  }
  return `已寫入 ${date} 的日記`
}

// --- Supabase: mood ---
async function upsertMood(date: string, energy: number, tags: string[], note: string): Promise<string> {
  const existing = await fetch(supabaseUrl(`mood?date=eq.${date}`), { headers: supabaseHeaders() })
  if (existing.ok) {
    const rows = await existing.json()
    if (Array.isArray(rows) && rows.length > 0) {
      await fetch(supabaseUrl(`mood?id=eq.${rows[0].id}`), {
        method: 'PATCH',
        headers: supabaseHeaders(),
        body: JSON.stringify({ energy, tags, note }),
      })
      return `已更新 ${date} 的心情（能量 ${energy}）`
    }
  }
  const res = await fetch(supabaseUrl('mood'), {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify({ date, energy, tags, note }),
  })
  if (!res.ok) {
    console.error('[upsertMood] Failed:', res.status, await res.text())
    return '心情記錄失敗'
  }
  return `已記錄 ${date} 的心情（能量 ${energy}）`
}

// --- Supabase: goals ---
async function fetchGoals(): Promise<{ id: string; title: string; position: number; completed: boolean }[]> {
  const res = await fetch(supabaseUrl('goals?order=position'), { headers: supabaseHeaders() })
  if (!res.ok) return []
  return res.json()
}

async function addGoal(title: string, position: number): Promise<string> {
  const res = await fetch(supabaseUrl('goals'), {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify({ title, position, completed: false, category: '其他', connections: [] }),
  })
  if (!res.ok) {
    console.error('[addGoal] Failed:', res.status, await res.text())
    return '新增目標失敗'
  }
  return `已新增目標 #${position}「${title}」`
}

async function updateGoalCompleted(id: string, completed: boolean, title: string): Promise<string> {
  const res = await fetch(supabaseUrl(`goals?id=eq.${id}`), {
    method: 'PATCH',
    headers: supabaseHeaders(),
    body: JSON.stringify({ completed, completed_at: completed ? new Date().toISOString() : null }),
  })
  if (!res.ok) return '更新目標失敗'
  return completed ? `目標「${title}」已完成 🎉` : `目標「${title}」標記為未完成`
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
    description: '新增一筆行程到 Google Calendar（有明確時間點的事項）。例如：開會、看醫生、搭車。',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: '日期，格式 YYYY-MM-DD' },
        title: { type: 'string', description: '行程名稱' },
        start_time: { type: 'string', description: '開始時間，格式 HH:mm（24小時制）' },
        end_time: { type: 'string', description: '結束時間，格式 HH:mm（選填，預設 +1 小時）' },
        location: { type: 'string', description: '地點（選填）' },
      },
      required: ['date', 'title', 'start_time'],
    },
  },
  {
    name: 'add_expense',
    description: '記帳。記錄一筆消費到 expenses 表。類別：餐飲/交通/治裝購物/學習/朋友社交/約會/日常採買/其他。',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: '日期，格式 YYYY-MM-DD' },
        title: { type: 'string', description: '消費項目' },
        amount: { type: 'number', description: '金額（數字）' },
        category: { type: 'string', description: '類別：餐飲/交通/治裝購物/學習/朋友社交/約會/日常採買/其他' },
        note: { type: 'string', description: '備註（選填）' },
      },
      required: ['date', 'title', 'amount', 'category'],
    },
  },
  {
    name: 'get_habit_definitions',
    description: '取得所有習慣定義列表（habit_definitions），用來查找 habit_id。打卡前先呼叫此工具。',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'add_habit_log',
    description: '習慣打卡。記錄今天完成了某個習慣。需要先呼叫 get_habit_definitions 取得 habit_id。',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: '日期，格式 YYYY-MM-DD' },
        habit_id: { type: 'string', description: '習慣定義的 UUID（從 get_habit_definitions 取得）' },
        habit_name: { type: 'string', description: '習慣名稱（用於回覆）' },
      },
      required: ['date', 'habit_id', 'habit_name'],
    },
  },
  {
    name: 'add_journal',
    description: '寫日記。寫入或更新當天的日記內容到 journal 表。',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: '日期，格式 YYYY-MM-DD' },
        content: { type: 'string', description: '日記內容' },
      },
      required: ['date', 'content'],
    },
  },
  {
    name: 'add_mood',
    description: '記錄心情。寫入或更新當天的心情到 mood 表。energy 1-5 分，tags 可選：平靜/興奮/疲憊/焦慮/快樂。',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: '日期，格式 YYYY-MM-DD' },
        energy: { type: 'number', description: '能量分數 1-5' },
        tags: { type: 'array', items: { type: 'string' }, description: '心情標籤：平靜/興奮/疲憊/焦慮/快樂' },
        note: { type: 'string', description: '心情備註（選填）' },
      },
      required: ['date', 'energy'],
    },
  },
  {
    name: 'get_goals',
    description: '取得所有年度目標列表。',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'add_goal',
    description: '新增一個年度目標到 goals 表。',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: '目標名稱' },
        position: { type: 'number', description: '目標編號（1-20）' },
      },
      required: ['title', 'position'],
    },
  },
  {
    name: 'complete_goal',
    description: '標記某個年度目標為已完成或未完成。',
    input_schema: {
      type: 'object' as const,
      properties: {
        goal_id: { type: 'string', description: '目標 UUID' },
        goal_title: { type: 'string', description: '目標名稱（用於回覆）' },
        completed: { type: 'boolean', description: 'true=完成, false=未完成' },
      },
      required: ['goal_id', 'goal_title', 'completed'],
    },
  },
  {
    name: 'delete_record',
    description: '刪除記錄。可以刪除 tasks/expenses/journal/mood/habit_logs 表中指定日期的資料。可用關鍵字篩選。',
    input_schema: {
      type: 'object' as const,
      properties: {
        table: { type: 'string', description: '表名：tasks / expenses / journal / mood / habit_logs' },
        date: { type: 'string', description: '日期，格式 YYYY-MM-DD' },
        title_match: { type: 'string', description: '名稱關鍵字篩選（選填，僅 tasks 和 expenses 有效）' },
      },
      required: ['table', 'date'],
    },
  },
  {
    name: 'postpone_task',
    description: '順延任務。把指定任務的日期改到新的日期（通常是明天）。用於「順延」「延到明天」「改到後天」等場景。',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_title: { type: 'string', description: '任務名稱（模糊比對）' },
        from_date: { type: 'string', description: '原本的日期，格式 YYYY-MM-DD' },
        to_date: { type: 'string', description: '順延到的日期，格式 YYYY-MM-DD' },
      },
      required: ['task_title', 'from_date', 'to_date'],
    },
  },
]

const SYSTEM_PROMPT = `你是個人助理 bot。回覆用繁體中文，語氣簡潔像朋友。今天是 ${getTodayTaipei()}。

核心規則：
- 回覆最多 2 句話，不說廢話、不給建議、不解釋、不問多餘的問題
- 不需要問確認，直接做完告訴用戶結果
- 一定要呼叫 tool，絕對不可以只回文字說「已新增」而不呼叫 tool
- 多個項目要分開呼叫，每個一次
- 禁止用 markdown 格式，這是 Telegram 訊息

分流規則（根據用戶意圖選擇正確的 tool）：

1. 待辦任務（沒有具體時間的事）→ add_task
   例：「買牛奶」「明天寄包裹」「這週訂高鐵票」
   有日期 → 直接寫入。沒日期 → 先 get_week_tasks 找最空的一天再寫入

2. 行程（有具體時間）→ add_calendar_event
   例：「明天下午3點開會」「週五10點看牙醫」

3. 記帳（花錢/消費）→ add_expense
   例：「午餐花了180」「記帳 交通 250」「咖啡 65」
   自動判斷類別：餐飲/交通/治裝購物/學習/朋友社交/約會/日常採買/其他
   沒說日期就用今天

4. 習慣打卡 → 先 get_habit_definitions 查 id，再 add_habit_log
   例：「今天運動打卡」「學英文完成」「韓文打卡」
   沒說日期就用今天

5. 日記 → add_journal
   例：「今天日記：今天很充實...」「日記：去了海邊」
   沒說日期就用今天

6. 心情記錄 → add_mood
   例：「今天心情4分」「心情：平靜」「能量3，有點焦慮」
   energy 1-5 分，tags 可選：平靜/興奮/疲憊/焦慮/快樂
   沒說日期就用今天

7. 年度目標 → get_goals / add_goal / complete_goal
   例：「新增目標：爬三座山」→ 先 get_goals 看下一個 position，再 add_goal
   例：「完成目標2」→ 先 get_goals 找到 position=2 的目標，再 complete_goal

8. 刪除記錄 → delete_record（支援 tasks/expenses/journal/mood/habit_logs）
   例：「刪除今天所有任務」「刪掉買牛奶」「刪除今天的記帳」「刪掉今天心情」「刪掉今天日記」

9. 順延任務 → postpone_task
   例：「順延到明天」「把那個延到後天」「好 你直接順延」
   需要 from_date（原日期）和 to_date（新日期），以及 task_title（任務名稱關鍵字）
   如果用戶沒指定要順延到哪天，預設順延到明天

10. 查詢 → get_tasks / get_week_tasks / get_goals / get_habit_definitions
   例：「今天有什麼事」「這週行程」「我的目標」

對話記憶：
- 你可以看到最近 5 輪對話歷史，用來理解上下文
- 用戶說「好」「可以」「順延」等簡短回覆時，根據上文判斷意圖
- 例如你剛列出未完成任務，用戶說「好 順延」，就把那些任務順延到明天`

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
    case 'add_expense': {
      const typedInput = input as Record<string, unknown>
      return addExpense(
        input.date,
        input.title,
        Number(typedInput.amount),
        input.category || '其他',
        input.note || '',
      )
    }
    case 'get_habit_definitions': {
      const habits = await fetchHabitDefinitions()
      if (habits.length === 0) return '目前沒有定義任何習慣。'
      return habits.map(h => `${h.id}: ${h.name}`).join('\n')
    }
    case 'add_habit_log': {
      return addHabitLog(input.date, input.habit_id, input.habit_name)
    }
    case 'add_journal': {
      return upsertJournal(input.date, input.content)
    }
    case 'add_mood': {
      const typedInput = input as Record<string, unknown>
      const tags = Array.isArray(typedInput.tags) ? typedInput.tags as string[] : []
      return upsertMood(input.date, Number(typedInput.energy), tags, input.note || '')
    }
    case 'get_goals': {
      const goals = await fetchGoals()
      if (goals.length === 0) return '目前沒有任何年度目標。'
      return goals.map(g => `#${g.position} ${g.title}${g.completed ? ' ✅' : ''} (id: ${g.id})`).join('\n')
    }
    case 'add_goal': {
      const typedInput = input as Record<string, unknown>
      return addGoal(input.title, Number(typedInput.position))
    }
    case 'complete_goal': {
      const typedInput = input as Record<string, unknown>
      return updateGoalCompleted(input.goal_id, Boolean(typedInput.completed), input.goal_title)
    }
    case 'delete_record': {
      const table = input.table
      const allowed = ['tasks', 'expenses', 'journal', 'mood', 'habit_logs']
      if (!allowed.includes(table)) return `不支援刪除 ${table} 表`
      const titleField = table === 'tasks' ? 'title' : table === 'expenses' ? 'title' : undefined
      const count = await deleteByDateAndTable(table, input.date, titleField, input.title_match)
      const label: Record<string, string> = { tasks: '任務', expenses: '記帳', journal: '日記', mood: '心情', habit_logs: '打卡' }
      if (count === 0) return `${input.date} 沒有${label[table] || '記錄'}可刪除`
      return `已刪除 ${count} 筆${label[table] || '記錄'}`
    }
    case 'postpone_task': {
      // Find the task by title match on the from_date
      const res = await fetch(
        supabaseUrl(`tasks?date=eq.${input.from_date}&title=ilike.*${encodeURIComponent(input.task_title)}*&limit=1`),
        { headers: supabaseHeaders() },
      )
      if (!res.ok) return '查詢任務失敗'
      const tasks = await res.json() as Task[]
      if (tasks.length === 0) return `找不到「${input.task_title}」這個任務（${input.from_date}）`
      const task = tasks[0]
      const ok = await updateTask(task.id, {
        date: input.to_date,
        carried_over: true,
        original_date: task.original_date || input.from_date,
      })
      if (!ok) return '順延失敗'
      return `已將「${task.title}」從 ${input.from_date} 順延到 ${input.to_date}`
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
  const history = await getHistory(chatId)

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

    console.log(`[chatWithClaude] stop_reason=${response.stop_reason}, iterations=${iterations}, reply_length=${reply.length}`)
    if (iterations === 0) {
      console.log('[chatWithClaude] WARNING: Claude did not call any tool for message:', userMessage)
    }

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

  // --- Credit card SMS parsing ---
  const cardMatch = trimmed.match(/您於(\d{1,2})\/(\d{1,2}).*?刷([\d,]+)元/)
  if (cardMatch) {
    const year = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }).slice(0, 4)
    const month = cardMatch[1].padStart(2, '0')
    const day = cardMatch[2].padStart(2, '0')
    const date = `${year}-${month}-${day}`
    const amount = parseInt(cardMatch[3].replace(/,/g, ''))
    const result = await addExpense(date, '永豐刷卡', amount, '其他', trimmed.slice(0, 100))
    if (result.startsWith('寫入失敗')) return `❌ ${result}`
    const formatted = amount.toLocaleString()
    return `幫你記了 ${parseInt(month)}/${parseInt(day)} 刷卡 ${formatted} 元，分類先設為其他，要改再告訴我`
  }

  // --- Apple Pay notification parsing ---
  // Format: "永豐銀行\n商家名稱\n$XXX.00"
  const applePayMatch = trimmed.match(/永豐銀行\n(.+)\n\$([\d,.]+)/)
  if (applePayMatch) {
    const merchant = applePayMatch[1].trim()
    const amount = Math.round(parseFloat(applePayMatch[2].replace(/,/g, '')))
    const date = getTodayTaipei()
    const result = await addExpense(date, merchant, amount, '其他', '')
    if (result.startsWith('寫入失敗')) return `❌ ${result}`
    return `記了 ${merchant} $${amount.toLocaleString()}，分類先設其他，要改再說`
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
