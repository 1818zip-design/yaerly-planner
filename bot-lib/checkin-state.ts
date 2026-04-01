import { supabaseUrl, supabaseHeaders, getTodayTaipei } from './helpers.js'
import { addExpense, fetchHabitDefinitions, addHabitLog, upsertMood } from './supabase-ops.js'

export interface CheckinState {
  step: 'expense' | 'habit' | 'mood_energy' | 'mood_tags' | 'done'
  missing: string[]  // which items are missing
  moodEnergy?: number
  date: string
}

const TWO_HOURS = 2 * 60 * 60 * 1000

// --- State CRUD ---
export async function getState(chatId: number): Promise<CheckinState | null> {
  const res = await fetch(
    supabaseUrl(`bot_state?chat_id=eq.${chatId}`),
    { headers: supabaseHeaders() },
  )
  if (!res.ok) return null
  const rows = await res.json() as { state: CheckinState; updated_at: string }[]
  if (rows.length === 0) return null
  // Check 2-hour expiry
  const updated = new Date(rows[0].updated_at).getTime()
  if (Date.now() - updated > TWO_HOURS) {
    await clearState(chatId)
    return null
  }
  return rows[0].state
}

export async function setState(chatId: number, state: CheckinState) {
  const body = { chat_id: String(chatId), state, updated_at: new Date().toISOString() }
  // Try update first
  const updateRes = await fetch(
    supabaseUrl(`bot_state?chat_id=eq.${chatId}`),
    { method: 'PATCH', headers: supabaseHeaders(), body: JSON.stringify({ state, updated_at: body.updated_at }) },
  )
  if (updateRes.ok) {
    const updated = await updateRes.json()
    if (Array.isArray(updated) && updated.length > 0) return
  }
  // Insert
  await fetch(supabaseUrl('bot_state'), {
    method: 'POST', headers: supabaseHeaders(), body: JSON.stringify(body),
  })
}

export async function clearState(chatId: number) {
  await fetch(supabaseUrl(`bot_state?chat_id=eq.${chatId}`), {
    method: 'DELETE', headers: supabaseHeaders(),
  })
}

// --- Check what's missing today ---
export async function checkMissing(date: string): Promise<string[]> {
  const missing: string[] = []
  const h = supabaseHeaders()

  const [expRes, habitRes, habitDefRes, moodRes] = await Promise.all([
    fetch(supabaseUrl(`expenses?date=eq.${date}&limit=1`), { headers: h }),
    fetch(supabaseUrl(`habit_logs?date=eq.${date}&limit=1`), { headers: h }),
    fetch(supabaseUrl(`habit_definitions?limit=1`), { headers: h }),
    fetch(supabaseUrl(`mood?date=eq.${date}&limit=1`), { headers: h }),
  ])

  const expenses = expRes.ok ? await expRes.json() as unknown[] : []
  const habits = habitRes.ok ? await habitRes.json() as unknown[] : []
  const habitDefs = habitDefRes.ok ? await habitDefRes.json() as unknown[] : []
  const moods = moodRes.ok ? await moodRes.json() as unknown[] : []

  if (expenses.length === 0) missing.push('expense')
  if (habitDefs.length > 0 && habits.length === 0) missing.push('habit')
  if (moods.length === 0) missing.push('mood_energy')

  return missing
}

// --- Get the prompt for current step ---
export function getStepPrompt(state: CheckinState): string {
  switch (state.step) {
    case 'expense':
      return '💰 今天有花錢嗎？格式：項目 金額 [分類]\n例如：午餐 120 餐飲\n\n回覆「略過」跳過'
    case 'habit':
      return '📅 習慣打卡！回覆習慣名稱，或「全部」一次打卡\n\n回覆「略過」跳過'
    case 'mood_energy':
      return '😊 今天能量幾分？(1-5)\n1=很低 2=偏低 3=普通 4=不錯 5=超好'
    case 'mood_tags':
      return '🏷️ 心情標籤？可選：平靜/興奮/疲憊/焦慮/快樂\n多個用逗號隔開，或「略過」'
    default:
      return ''
  }
}

// --- Process user reply for current step ---
export async function processStepReply(chatId: number, state: CheckinState, text: string): Promise<string> {
  const trimmed = text.trim()
  const isSkip = ['略過', '跳過', 'skip', '不用'].includes(trimmed)

  switch (state.step) {
    case 'expense': {
      if (!isSkip) {
        // Parse: "項目 金額 [分類]"
        const match = trimmed.match(/^(.+?)\s+(\d+)\s*(.*)$/)
        if (match) {
          const title = match[1]
          const amount = parseInt(match[2])
          const category = match[3] || '其他'
          const validCats = ['餐飲', '交通', '治裝購物', '學習', '朋友社交', '約會', '日常採買', '其他']
          const cat = validCats.includes(category) ? category : '其他'
          await addExpense(state.date, title, amount, cat, '')
        } else {
          return '格式：項目 金額 [分類]，例如「午餐 120 餐飲」\n或回覆「略過」'
        }
      }
      // Move to next missing step
      return advanceState(chatId, state)
    }

    case 'habit': {
      if (!isSkip) {
        const defs = await fetchHabitDefinitions()
        if (trimmed === '全部') {
          for (const d of defs) {
            await addHabitLog(state.date, d.id, d.name)
          }
        } else {
          const found = defs.find(d => d.name.includes(trimmed) || trimmed.includes(d.name))
          if (found) {
            await addHabitLog(state.date, found.id, found.name)
          } else {
            return `找不到「${trimmed}」，可選：${defs.map(d => d.name).join('、')}、全部\n或回覆「略過」`
          }
        }
      }
      return advanceState(chatId, state)
    }

    case 'mood_energy': {
      if (isSkip) {
        // Skip mood entirely (skip both energy + tags)
        const nextMissing = state.missing.filter(m => m !== 'mood_energy')
        state.missing = nextMissing
        return advanceState(chatId, state)
      }
      const energy = parseInt(trimmed)
      if (isNaN(energy) || energy < 1 || energy > 5) {
        return '請輸入 1-5 的數字'
      }
      state.moodEnergy = energy
      state.step = 'mood_tags'
      await setState(chatId, state)
      return getStepPrompt(state)
    }

    case 'mood_tags': {
      const tags = isSkip ? [] : trimmed.split(/[,，、]/).map(s => s.trim()).filter(Boolean)
      await upsertMood(state.date, state.moodEnergy || 3, tags, '')
      return advanceState(chatId, state)
    }

    default:
      await clearState(chatId)
      return '✅ check-in 完成！'
  }
}

// --- Advance to next missing step ---
async function advanceState(chatId: number, state: CheckinState): Promise<string> {
  // Find next step from missing list
  const currentIdx = state.missing.indexOf(state.step)
  const remaining = state.missing.slice(currentIdx + 1)

  if (remaining.length === 0) {
    await clearState(chatId)
    return '✅ 今天的 check-in 完成了！'
  }

  state.step = remaining[0] as CheckinState['step']
  await setState(chatId, state)
  return getStepPrompt(state)
}
