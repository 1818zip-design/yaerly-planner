import { supabaseUrl, supabaseHeaders } from './helpers.js'

export interface Task {
  id: string
  title: string
  completed: boolean
  date: string
  carried_over: boolean
  tags: string[]
  goal_id: string | null
  original_date: string | null
}

// --- Tasks ---
export async function fetchTasksByDate(date: string): Promise<Task[]> {
  const res = await fetch(supabaseUrl(`tasks?date=eq.${date}&order=created_at`), { headers: supabaseHeaders() })
  if (!res.ok) return []
  return res.json()
}

export async function fetchTasksRange(startDate: string, endDate: string): Promise<Task[]> {
  const res = await fetch(
    supabaseUrl(`tasks?date=gte.${startDate}&date=lte.${endDate}&order=date,created_at`),
    { headers: supabaseHeaders() },
  )
  if (!res.ok) return []
  return res.json()
}

export async function addTaskToDate(date: string, title: string): Promise<Task | null> {
  const body = {
    title, date, time_slot: 'anytime',
    completed: false, carried_over: false, tags: [], goal_id: null,
  }
  console.log('[addTaskToDate] Inserting:', JSON.stringify(body))
  const res = await fetch(supabaseUrl('tasks'), {
    method: 'POST', headers: supabaseHeaders(), body: JSON.stringify(body),
  })
  if (!res.ok) {
    console.error('[addTaskToDate] Failed:', res.status, await res.text())
    return null
  }
  const data = await res.json()
  const task = Array.isArray(data) ? data[0] : data
  console.log('[addTaskToDate] Success:', task?.id, task?.title)
  return task
}

export async function updateTask(id: string, updates: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(supabaseUrl(`tasks?id=eq.${id}`), {
    method: 'PATCH', headers: supabaseHeaders(), body: JSON.stringify(updates),
  })
  return res.ok
}

export async function deleteTaskById(id: string): Promise<boolean> {
  const res = await fetch(supabaseUrl(`tasks?id=eq.${id}`), {
    method: 'DELETE', headers: supabaseHeaders(),
  })
  return res.ok
}

// --- Generic delete ---
export async function deleteByDateAndTable(table: string, date: string, titleField?: string, titleMatch?: string): Promise<number> {
  let query = `${table}?date=eq.${date}`
  if (titleField && titleMatch) query += `&${titleField}=ilike.*${encodeURIComponent(titleMatch)}*`
  console.log('[delete]', table, query)
  const res = await fetch(supabaseUrl(query), {
    method: 'DELETE', headers: { ...supabaseHeaders(), Prefer: 'return=representation' },
  })
  if (!res.ok) { console.error('[delete] Failed:', res.status, await res.text()); return 0 }
  const data = await res.json()
  return Array.isArray(data) ? data.length : 0
}

// --- Expenses ---
export async function addExpense(date: string, title: string, amount: number, category: string, note: string): Promise<string> {
  const body = { date, title, amount, category, note }
  console.log('[addExpense] Inserting:', JSON.stringify(body))
  const res = await fetch(supabaseUrl('expenses'), {
    method: 'POST', headers: supabaseHeaders(), body: JSON.stringify(body),
  })
  if (!res.ok) { console.error('[addExpense] Failed:', res.status, await res.text()); return '寫入失敗' }
  const data = await res.json()
  const row = Array.isArray(data) ? data[0] : data
  console.log('[addExpense] Success:', row?.id)
  return `已記帳「${title}」${amount} 元（${category}）到 ${date}`
}

// --- Habits ---
export async function fetchHabitDefinitions(): Promise<{ id: string; name: string }[]> {
  const res = await fetch(supabaseUrl('habit_definitions?order=created_at'), { headers: supabaseHeaders() })
  if (!res.ok) return []
  return res.json()
}

export async function addHabitLog(date: string, habitId: string, habitName: string): Promise<string> {
  const existing = await fetch(supabaseUrl(`habit_logs?date=eq.${date}&habit_id=eq.${habitId}`), { headers: supabaseHeaders() })
  if (existing.ok) {
    const rows = await existing.json()
    if (Array.isArray(rows) && rows.length > 0) {
      await fetch(supabaseUrl(`habit_logs?id=eq.${rows[0].id}`), {
        method: 'PATCH', headers: supabaseHeaders(), body: JSON.stringify({ completed: true }),
      })
      return `「${habitName}」今天已打卡（更新）`
    }
  }
  const res = await fetch(supabaseUrl('habit_logs'), {
    method: 'POST', headers: supabaseHeaders(),
    body: JSON.stringify({ date, habit_id: habitId, completed: true, note: '' }),
  })
  if (!res.ok) { console.error('[addHabitLog] Failed:', res.status, await res.text()); return '打卡失敗' }
  console.log('[addHabitLog] Success:', habitName, date)
  return `「${habitName}」打卡完成（${date}）`
}

// --- Journal ---
export async function upsertJournal(date: string, content: string): Promise<string> {
  const now = new Date().toISOString()
  const existing = await fetch(supabaseUrl(`journal?date=eq.${date}`), { headers: supabaseHeaders() })
  if (existing.ok) {
    const rows = await existing.json()
    if (Array.isArray(rows) && rows.length > 0) {
      await fetch(supabaseUrl(`journal?id=eq.${rows[0].id}`), {
        method: 'PATCH', headers: supabaseHeaders(), body: JSON.stringify({ content, updated_at: now }),
      })
      return `已更新 ${date} 的日記`
    }
  }
  const res = await fetch(supabaseUrl('journal'), {
    method: 'POST', headers: supabaseHeaders(), body: JSON.stringify({ date, content, updated_at: now }),
  })
  if (!res.ok) { console.error('[upsertJournal] Failed:', res.status, await res.text()); return '日記寫入失敗' }
  return `已寫入 ${date} 的日記`
}

// --- Mood ---
export async function upsertMood(date: string, energy: number, tags: string[], note: string): Promise<string> {
  const existing = await fetch(supabaseUrl(`mood?date=eq.${date}`), { headers: supabaseHeaders() })
  if (existing.ok) {
    const rows = await existing.json()
    if (Array.isArray(rows) && rows.length > 0) {
      await fetch(supabaseUrl(`mood?id=eq.${rows[0].id}`), {
        method: 'PATCH', headers: supabaseHeaders(), body: JSON.stringify({ energy, tags, note }),
      })
      return `已更新 ${date} 的心情（能量 ${energy}）`
    }
  }
  const res = await fetch(supabaseUrl('mood'), {
    method: 'POST', headers: supabaseHeaders(), body: JSON.stringify({ date, energy, tags, note }),
  })
  if (!res.ok) { console.error('[upsertMood] Failed:', res.status, await res.text()); return '心情記錄失敗' }
  return `已記錄 ${date} 的心情（能量 ${energy}）`
}

// --- Goals ---
export async function fetchGoals(): Promise<{ id: string; title: string; position: number; completed: boolean }[]> {
  const res = await fetch(supabaseUrl('goals?order=position'), { headers: supabaseHeaders() })
  if (!res.ok) return []
  return res.json()
}

export async function addGoal(title: string, position: number): Promise<string> {
  const res = await fetch(supabaseUrl('goals'), {
    method: 'POST', headers: supabaseHeaders(),
    body: JSON.stringify({ title, position, completed: false, category: '其他', connections: [] }),
  })
  if (!res.ok) { console.error('[addGoal] Failed:', res.status, await res.text()); return '新增目標失敗' }
  return `已新增目標 #${position}「${title}」`
}

export async function updateGoalCompleted(id: string, completed: boolean, title: string): Promise<string> {
  const res = await fetch(supabaseUrl(`goals?id=eq.${id}`), {
    method: 'PATCH', headers: supabaseHeaders(),
    body: JSON.stringify({ completed, completed_at: completed ? new Date().toISOString() : null }),
  })
  if (!res.ok) return '更新目標失敗'
  return completed ? `目標「${title}」已完成 🎉` : `目標「${title}」標記為未完成`
}
