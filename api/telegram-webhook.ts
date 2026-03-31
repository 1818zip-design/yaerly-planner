/**
 * Telegram Webhook - AI-powered personal assistant
 *
 * Modules:
 *   lib/helpers.ts       — env, dates, supabase config
 *   lib/telegram.ts      — send message, download photo
 *   lib/memory.ts        — conversation history (Supabase-backed)
 *   lib/google-calendar.ts — Google Calendar API
 *   lib/supabase-ops.ts  — all Supabase CRUD operations
 *   lib/bot-tools.ts     — Claude tool definitions + executor
 *   lib/bot-prompt.ts    — system prompt
 *   lib/photo-parser.ts  — calendar screenshot parsing
 */

import Anthropic from '@anthropic-ai/sdk'
import { env, getTodayTaipei } from './lib/helpers.js'
import { type TelegramUpdate, sendTelegram } from './lib/telegram.js'
import { getHistory, pushHistory } from './lib/memory.js'
import { createCalendarEvent } from './lib/google-calendar.js'
import { fetchTasksByDate, updateTask, addExpense, findRecentDuplicateExpense } from './lib/supabase-ops.js'
import { CLAUDE_TOOLS, executeTool } from './lib/bot-tools.js'
import { getSystemPrompt } from './lib/bot-prompt.js'
import { type ParsedEvent, handlePhotoMessage } from './lib/photo-parser.js'
import { getState, setState, clearState, checkMissing, getStepPrompt, processStepReply, type CheckinState } from './lib/checkin-state.js'

// --- Format helpers ---
function formatTaskList(tasks: { id: string; title: string; completed: boolean; carried_over: boolean }[], date: string): string {
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
      system: getSystemPrompt(),
      tools: CLAUDE_TOOLS,
      messages,
    })

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
        system: getSystemPrompt(),
        tools: CLAUDE_TOOLS,
        messages,
      })
    }

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

// --- Bank notification parser (uses Claude API) ---
interface ParsedExpense {
  date: string
  amount: number
  title: string
  category: string
  note: string
}

const BANK_PARSE_PROMPT = `你是記帳助理，從永豐銀行通知擷取消費資訊，只回傳 JSON 不說其他話。

回傳格式：
{
  "date": "YYYY-MM-DD",
  "amount": 台幣金額數字,
  "title": "商店名稱",
  "category": "餐飲/交通/治裝購物/學習/朋友社交/約會/日常採買/其他 選一",
  "note": "外幣時填原幣金額如 USD 10.00，台幣時為空字串"
}

分類參考：
- 餐飲：餐廳、咖啡、飲料、foodpanda、Uber Eats
- 交通：優步、Uber、捷運、停車、加油
- 治裝購物：服飾、鞋、包
- 學習：書、課程、Anthropic、Claude、訂閱、軟體工具
- 日常採買：蝦皮、全聯、超商、藥妝、LINE Pay
- 其他：無法判斷時

注意：
- 民國年轉西元年：民國115年=2026年
- 日期格式如 1150331 表示民國115年03月31日，轉為 2026-03-31
- 台幣金額取整數`

async function parseBankNotification(text: string): Promise<ParsedExpense | null> {
  const apiKey = env('ANTHROPIC_API_KEY')
  if (!apiKey) return null

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      system: BANK_PARSE_PROMPT,
      messages: [{ role: 'user', content: text }],
    })

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    )
    if (!textBlock) return null

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = textBlock.text.trim()
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) jsonStr = jsonMatch[1].trim()

    const parsed = JSON.parse(jsonStr) as ParsedExpense
    if (!parsed.date || !parsed.title || typeof parsed.amount !== 'number') return null
    return parsed
  } catch (err) {
    console.error('[parseBankNotification] Error:', err)
    return null
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
    const { deleteTaskById } = await import('./lib/supabase-ops.js')
    await deleteTaskById(task.id)
    return `🗑 已刪除：${task.title}`
  }

  if (trimmed.startsWith('/')) {
    return '❓ 未知指令，輸入 /help 查看可用指令'
  }

  // --- __BANK__ prefix: smart bank notification parsing via Claude ---
  if (trimmed.startsWith('__BANK__')) {
    const bankText = trimmed.slice('__BANK__'.length).trim()
    if (!bankText) return '⚠️ 通知內容為空'

    const parsed = await parseBankNotification(bankText)
    if (!parsed) return '⚠️ 解析失敗，請手動記帳'

    // Duplicate check: same title + amount + date within 5 minutes
    const isDup = await findRecentDuplicateExpense(parsed.date, parsed.title, parsed.amount)
    if (isDup) return '⚠️ 疑似重複通知，已略過'

    const result = await addExpense(parsed.date, parsed.title, parsed.amount, parsed.category, parsed.note)
    if (result.startsWith('寫入失敗')) return `❌ ${result}`

    const lines = [
      '✅ 已記帳',
      `📅 ${parsed.date}`,
      `🏪 ${parsed.title}`,
      `💰 NT$ ${parsed.amount.toLocaleString()}`,
      `🏷️ ${parsed.category}`,
    ]
    if (parsed.note) lines.push(`📎 ${parsed.note}`)
    return lines.join('\n')
  }

  // --- Credit card SMS parsing (legacy, without __BANK__ prefix) ---
  const cardMatch = trimmed.match(/您於(\d{1,2})\/(\d{1,2}).*?刷([\d,]+)元/)
  if (cardMatch) {
    const year = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }).slice(0, 4)
    const month = cardMatch[1].padStart(2, '0')
    const day = cardMatch[2].padStart(2, '0')
    const date = `${year}-${month}-${day}`
    const amount = parseInt(cardMatch[3].replace(/,/g, ''))
    const result = await addExpense(date, '永豐刷卡', amount, '其他', trimmed.slice(0, 100))
    if (result.startsWith('寫入失敗')) return `❌ ${result}`
    return `幫你記了 ${parseInt(month)}/${parseInt(day)} 刷卡 ${amount.toLocaleString()} 元，分類先設為其他，要改再告訴我`
  }

  // --- Apple Pay notification parsing (legacy) ---
  const applePayMatch = trimmed.match(/永豐銀行\n(.+)\n\$([\d,.]+)/)
  if (applePayMatch) {
    const merchant = applePayMatch[1].trim()
    const amount = Math.round(parseFloat(applePayMatch[2].replace(/,/g, '')))
    const date = getTodayTaipei()
    const result = await addExpense(date, merchant, amount, '其他', '')
    if (result.startsWith('寫入失敗')) return `❌ ${result}`
    return `記了 ${merchant} $${amount.toLocaleString()}，分類先設其他，要改再說`
  }

  return null
}

// --- Check for pending calendar events from screenshot ---
async function handlePendingEvents(chatId: number, text: string): Promise<string | null> {
  const trimmed = text.trim().toLowerCase()
  const isConfirm = ['好', '可以', 'ok', '是', '對', '就這樣', '加', '幫我加'].some(w => trimmed.includes(w))
  if (!isConfirm) return null

  const history = await getHistory(chatId)
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]
    if (msg.role !== 'assistant') continue
    const match = msg.content.match(/\[PENDING_EVENTS:(.+?)\]/)
    if (!match) continue

    try {
      const events: ParsedEvent[] = JSON.parse(match[1])
      let added = 0
      const errors: string[] = []
      for (const e of events) {
        const result = await createCalendarEvent({
          title: e.title, date: e.date, start_time: e.time,
          location: e.location || undefined,
        })
        if (result.includes('❌')) errors.push(`${e.title}: ${result}`)
        else added++
      }

      await pushHistory(chatId, 'user', text)
      await pushHistory(chatId, 'assistant', `已加 ${added} 個行程到 Google Calendar`)

      if (errors.length > 0) return `已加 ${added} 個行程，${errors.length} 個失敗：\n${errors.join('\n')}`
      return `已幫你加了 ${added} 個行程到 Google Calendar`
    } catch {
      return null
    }
  }
  return null
}

// --- Main handler ---
async function handleMessage(chatId: number, text: string): Promise<string> {
  const allowedChat = env('TELEGRAM_CHAT_ID')
  if (allowedChat && String(chatId) !== allowedChat) {
    return '⛔ 未授權的使用者'
  }

  // --- Check-in state machine ---
  const state = await getState(chatId)
  if (state && state.step !== 'done') {
    // User is in check-in flow
    if (text.trim() === '取消' || text.trim() === '結束') {
      await clearState(chatId)
      return '已取消 check-in'
    }
    return processStepReply(chatId, state, text)
  }

  // Start check-in when user says "好" after check-in reminder
  const trimmedLower = text.trim().toLowerCase()
  if (['好', '好的', '開始', '開始checkin', '開始 checkin', 'checkin'].includes(trimmedLower)) {
    const today = getTodayTaipei()
    const missing = await checkMissing(today)
    if (missing.length === 0) {
      return '✅ 今天都記錄了，不需要補'
    }
    const newState: CheckinState = { step: missing[0] as CheckinState['step'], missing, date: today }
    await setState(chatId, newState)
    return `開始 check-in（${missing.length} 項）\n\n${getStepPrompt(newState)}`
  }

  const pendingResult = await handlePendingEvents(chatId, text)
  if (pendingResult !== null) return pendingResult

  const directResult = await handleDirectCommand(chatId, text)
  if (directResult !== null) return directResult

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
    const photos = update.message?.photo

    if (!chatId) {
      return res.status(200).json({ ok: true, skip: 'no chat id' })
    }

    if (photos && photos.length > 0) {
      const allowedChat = env('TELEGRAM_CHAT_ID')
      if (allowedChat && String(chatId) !== allowedChat) {
        await sendTelegram(chatId, '⛔ 未授權的使用者')
        return res.status(200).json({ ok: true })
      }
      const reply = await handlePhotoMessage(chatId, photos)
      await sendTelegram(chatId, reply)
      return res.status(200).json({ ok: true })
    }

    if (!text) {
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
