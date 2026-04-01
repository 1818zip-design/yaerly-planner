import Anthropic from '@anthropic-ai/sdk'
import { supabaseUrl, supabaseHeaders, getTodayTaipei, addDaysToDate } from './helpers.js'
import { createCalendarEvent } from './google-calendar.js'
import {
  Task, fetchTasksByDate, fetchTasksRange, addTaskToDate, updateTask,
  deleteByDateAndTable, addExpense, fetchHabitDefinitions, addHabitLog,
  upsertMood, fetchGoals, addGoal, updateGoalCompleted,
} from './supabase-ops.js'

export const CLAUDE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_tasks',
    description: '取得指定日期的任務列表。回傳該天所有任務，包含完成狀態。',
    input_schema: {
      type: 'object' as const,
      properties: { date: { type: 'string', description: '日期，格式 YYYY-MM-DD' } },
      required: ['date'],
    },
  },
  {
    name: 'get_week_tasks',
    description: '取得今天起未來 7 天的所有任務。用來查看哪天比較空、安排新任務。',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'add_task',
    description: '新增一筆待辦任務到 Supabase（沒有明確時間點的事項）。',
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
    description: '新增一筆行程到 Google Calendar（有明確時間點的事項）。',
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
    description: '記帳。類別：餐飲/交通/治裝購物/學習/朋友社交/約會/日常採買/其他。',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: '日期，格式 YYYY-MM-DD' },
        title: { type: 'string', description: '消費項目' },
        amount: { type: 'number', description: '金額（數字）' },
        category: { type: 'string', description: '類別' },
        note: { type: 'string', description: '備註（選填）' },
      },
      required: ['date', 'title', 'amount', 'category'],
    },
  },
  {
    name: 'get_habit_definitions',
    description: '取得所有習慣定義列表，用來查找 habit_id。',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'add_habit_log',
    description: '習慣打卡。需要先呼叫 get_habit_definitions 取得 habit_id。',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: '日期，格式 YYYY-MM-DD' },
        habit_id: { type: 'string', description: '習慣定義的 UUID' },
        habit_name: { type: 'string', description: '習慣名稱（用於回覆）' },
      },
      required: ['date', 'habit_id', 'habit_name'],
    },
  },
  {
    name: 'add_mood',
    description: '記錄心情。energy 1-5 分，tags 可選：平靜/興奮/疲憊/焦慮/快樂。',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: '日期，格式 YYYY-MM-DD' },
        energy: { type: 'number', description: '能量分數 1-5' },
        tags: { type: 'array', items: { type: 'string' }, description: '心情標籤' },
        note: { type: 'string', description: '心情備註（選填）' },
      },
      required: ['date', 'energy'],
    },
  },
  {
    name: 'get_goals',
    description: '取得所有年度目標列表。',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'add_goal',
    description: '新增一個年度目標。',
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
    description: '刪除記錄。支援 tasks/expenses/mood/habit_logs。',
    input_schema: {
      type: 'object' as const,
      properties: {
        table: { type: 'string', description: '表名' },
        date: { type: 'string', description: '日期，格式 YYYY-MM-DD' },
        title_match: { type: 'string', description: '名稱關鍵字篩選（選填）' },
      },
      required: ['table', 'date'],
    },
  },
  {
    name: 'postpone_task',
    description: '順延任務到新的日期。',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_title: { type: 'string', description: '任務名稱（模糊比對）' },
        from_date: { type: 'string', description: '原本的日期' },
        to_date: { type: 'string', description: '順延到的日期' },
      },
      required: ['task_title', 'from_date', 'to_date'],
    },
  },
  {
    name: 'complete_task',
    description: '標記任務完成。用名稱模糊比對。__ALL__ 表示全部完成。',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: '任務日期（預設今天）' },
        task_title: { type: 'string', description: '任務名稱關鍵字或 __ALL__' },
      },
      required: ['date', 'task_title'],
    },
  },
]

export async function executeTool(name: string, input: Record<string, string>): Promise<string> {
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
      const overdueRes = await fetch(
        supabaseUrl(`tasks?date=lt.${today}&completed=eq.false&order=date,created_at`),
        { headers: supabaseHeaders() },
      )
      const overdueTasks: Task[] = overdueRes.ok ? await overdueRes.json() : []
      const byDate: Record<string, Task[]> = {}
      for (let i = 0; i < 7; i++) { byDate[addDaysToDate(today, i)] = [] }
      for (const t of tasks) { if (byDate[t.date]) byDate[t.date].push(t) }
      const parts: string[] = []
      if (overdueTasks.length > 0) {
        parts.push(`⚠️ 過期未完成（${overdueTasks.length} 筆）：\n${overdueTasks.map(t => `  - [ ] ${t.title}（原 ${t.date}）`).join('\n')}`, '')
      }
      const weekLines = Object.entries(byDate).map(([date, dt]) => {
        const dow = new Date(date + 'T00:00:00+08:00').toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', weekday: 'short' })
        const inc = dt.filter(t => !t.completed).length
        const names = dt.map(t => `  - [${t.completed ? '✓' : ' '}] ${t.title}`).join('\n')
        return `${date}（${dow}）：${dt.length} 筆任務，${inc} 筆未完成${names ? '\n' + names : ''}`
      })
      parts.push(`未來 7 天任務概覽：\n${weekLines.join('\n')}`)
      return parts.join('\n')
    }
    case 'add_task': {
      console.log('[executeTool] add_task called:', input.date, input.title)
      const task = await addTaskToDate(input.date, input.title)
      if (!task) { console.error('[executeTool] add_task failed'); return '新增失敗，Supabase 寫入錯誤' }
      console.log('[executeTool] add_task success, id:', task.id)
      return `已成功新增待辦任務「${input.title}」到 ${input.date}，task id: ${task.id}`
    }
    case 'add_calendar_event':
      return createCalendarEvent({ title: input.title, date: input.date, start_time: input.start_time, end_time: input.end_time, location: input.location })
    case 'add_expense': {
      const ti = input as Record<string, unknown>
      return addExpense(input.date, input.title, Number(ti.amount), input.category || '其他', input.note || '')
    }
    case 'get_habit_definitions': {
      const habits = await fetchHabitDefinitions()
      if (habits.length === 0) return '目前沒有定義任何習慣。'
      return habits.map(h => `${h.id}: ${h.name}`).join('\n')
    }
    case 'add_habit_log':
      return addHabitLog(input.date, input.habit_id, input.habit_name)
    case 'add_mood': {
      const ti = input as Record<string, unknown>
      return upsertMood(input.date, Number(ti.energy), Array.isArray(ti.tags) ? ti.tags as string[] : [], input.note || '')
    }
    case 'get_goals': {
      const goals = await fetchGoals()
      if (goals.length === 0) return '目前沒有任何年度目標。'
      return goals.map(g => `#${g.position} ${g.title}${g.completed ? ' ✅' : ''} (id: ${g.id})`).join('\n')
    }
    case 'add_goal': {
      const ti = input as Record<string, unknown>
      return addGoal(input.title, Number(ti.position))
    }
    case 'complete_goal': {
      const ti = input as Record<string, unknown>
      return updateGoalCompleted(input.goal_id, Boolean(ti.completed), input.goal_title)
    }
    case 'delete_record': {
      const table = input.table
      const allowed = ['tasks', 'expenses', 'mood', 'habit_logs']
      if (!allowed.includes(table)) return `不支援刪除 ${table} 表`
      const titleField = table === 'tasks' || table === 'expenses' ? 'title' : undefined
      const count = await deleteByDateAndTable(table, input.date, titleField, input.title_match)
      const label: Record<string, string> = { tasks: '任務', expenses: '記帳', mood: '心情', habit_logs: '打卡' }
      if (count === 0) return `${input.date} 沒有${label[table] || '記錄'}可刪除`
      return `已刪除 ${count} 筆${label[table] || '記錄'}`
    }
    case 'postpone_task': {
      const res = await fetch(
        supabaseUrl(`tasks?date=eq.${input.from_date}&title=ilike.*${encodeURIComponent(input.task_title)}*&limit=1`),
        { headers: supabaseHeaders() },
      )
      if (!res.ok) return '查詢任務失敗'
      const tasks = await res.json() as Task[]
      if (tasks.length === 0) return `找不到「${input.task_title}」這個任務（${input.from_date}）`
      const task = tasks[0]
      const ok = await updateTask(task.id, { date: input.to_date, carried_over: true, original_date: task.original_date || input.from_date })
      if (!ok) return '順延失敗'
      return `已將「${task.title}」從 ${input.from_date} 順延到 ${input.to_date}`
    }
    case 'complete_task': {
      if (input.task_title === '__ALL__') {
        const res = await fetch(supabaseUrl(`tasks?date=eq.${input.date}&completed=eq.false`), { headers: supabaseHeaders() })
        if (!res.ok) return '查詢失敗'
        const incomplete = await res.json() as Task[]
        if (incomplete.length === 0) return `${input.date} 沒有未完成的任務`
        let count = 0
        for (const t of incomplete) { if (await updateTask(t.id, { completed: true })) count++ }
        return `已將 ${input.date} 的 ${count} 筆任務全部標記完成`
      }
      let found: Task[] = []
      const r1 = await fetch(supabaseUrl(`tasks?date=eq.${input.date}&title=ilike.*${encodeURIComponent(input.task_title)}*&completed=eq.false&limit=1`), { headers: supabaseHeaders() })
      if (r1.ok) found = await r1.json() as Task[]
      if (found.length === 0) {
        const r2 = await fetch(supabaseUrl(`tasks?title=ilike.*${encodeURIComponent(input.task_title)}*&completed=eq.false&order=date.desc&limit=1`), { headers: supabaseHeaders() })
        if (r2.ok) found = await r2.json() as Task[]
      }
      if (found.length === 0) return `找不到「${input.task_title}」這個未完成任務`
      const ok = await updateTask(found[0].id, { completed: true })
      if (!ok) return '標記失敗'
      return `已把「${found[0].title}」標記完成`
    }
    default:
      return `未知工具：${name}`
  }
}
