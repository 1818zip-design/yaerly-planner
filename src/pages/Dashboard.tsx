import { useEffect, useState } from 'react'
import { supabase, getToday } from '../lib/supabase'
import type { Task, Goal, HabitDefinition, HabitLog, Expense, Mood } from '../types'
import { CheckCircle, Circle, Zap, TrendingUp, Target } from 'lucide-react'

const TODAY = getToday()

const DAYS_ZH = ['日', '一', '二', '三', '四', '五', '六']
const MONTHS_ZH = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']

function formatDateZh(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getFullYear()} 年 ${MONTHS_ZH[d.getMonth()]} 月 ${d.getDate()} 日 （週${DAYS_ZH[d.getDay()]}）`
}

const ENERGY_COLORS = ['', '#ef4444', '#f97316', '#eab308', '#22c55e', '#6366f1']
const ENERGY_LABELS = ['', '很低', '偏低', '普通', '不錯', '超好']
const HABIT_COLORS = ['#5C7A6B', '#6B8AAE', '#C4A06B', '#B07A8A', '#8B7EB5', '#6BA5A5', '#C47070', '#C49060']

const GOAL_CATEGORY_COLORS: Record<string, string> = {
  健康: '#22c55e', 學習: '#3b82f6', 工作: '#f59e0b', 關係: '#ec4899',
  財務: '#10b981', 創作: '#8b5cf6', 旅遊: '#06b6d4', 生活: '#f97316', 其他: '#6b7280',
}

/* iOS-style design tokens */
const card = {
  backgroundColor: '#FFFFFF',
  borderRadius: '14px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  padding: '20px',
} as const

const sectionHeader = {
  fontSize: '13px',
  color: '#6C6C70',
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
}

const separator = {
  borderBottom: '0.5px solid rgba(60,60,67,0.12)',
}

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [goalTasks, setGoalTasks] = useState<Task[]>([])
  const [habitDefs, setHabitDefs] = useState<HabitDefinition[]>([])
  const [habitLogs, setHabitLogs] = useState<HabitLog[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [mood, setMood] = useState<Mood | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAll()
  }, [])

  async function fetchAll() {
    setLoading(true)
    const [tasksRes, goalsRes, goalTasksRes, defsRes, logsRes, expensesRes, moodRes] = await Promise.all([
      supabase.from('tasks').select('*').eq('date', TODAY).order('created_at'),
      supabase.from('goals').select('*').eq('completed', false).order('position'),
      supabase.from('tasks').select('*').not('goal_id', 'is', null),
      supabase.from('habit_definitions').select('*').order('created_at'),
      supabase.from('habit_logs').select('*').eq('date', TODAY),
      supabase.from('expenses').select('*').eq('date', TODAY),
      supabase.from('mood').select('*').eq('date', TODAY).maybeSingle(),
    ])
    if (tasksRes.data) setTasks(tasksRes.data)
    if (goalsRes.data) setGoals(goalsRes.data)
    if (goalTasksRes.data) setGoalTasks(goalTasksRes.data)
    if (defsRes.data) setHabitDefs(defsRes.data)
    if (logsRes.data) setHabitLogs(logsRes.data)
    if (expensesRes.data) setExpenses(expensesRes.data)
    if (moodRes.data) setMood(moodRes.data)
    setLoading(false)
  }

  async function toggleTask(task: Task) {
    const { data } = await supabase
      .from('tasks').update({ completed: !task.completed }).eq('id', task.id).select().single()
    if (data) setTasks(prev => prev.map(t => (t.id === data.id ? data : t)))
  }

  async function toggleHabitLog(habitId: string) {
    const existing = habitLogs.find(l => l.habit_id === habitId)
    if (existing) {
      if (existing.completed) {
        await supabase.from('habit_logs').delete().eq('id', existing.id)
        setHabitLogs(prev => prev.filter(l => l.id !== existing.id))
      } else {
        const { data } = await supabase
          .from('habit_logs').update({ completed: true }).eq('id', existing.id).select().single()
        if (data) setHabitLogs(prev => prev.map(l => l.id === data.id ? data : l))
      }
    } else {
      const { data } = await supabase
        .from('habit_logs')
        .insert({ date: TODAY, habit_id: habitId, completed: true, note: '' })
        .select().single()
      if (data) setHabitLogs(prev => [...prev, data])
    }
  }

  function isHabitDone(habitId: string) {
    return habitLogs.some(l => l.habit_id === habitId && l.completed)
  }

  const completedTasks = tasks.filter(t => t.completed).length
  const totalTasks = tasks.length
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0)

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', color: '#AEAEB2' }}>
        載入中...
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 16px', maxWidth: '480px', margin: '0 auto', backgroundColor: '#F2F2F7', minHeight: '100dvh' }}>
      {/* Date header */}
      <div style={{ marginBottom: '28px' }}>
        <p style={{ ...sectionHeader, margin: 0 }}>TODAY</p>
        <h1 style={{ fontSize: '18px', fontWeight: '700', color: '#1C1C1E', margin: '4px 0 0 0' }}>
          {formatDateZh(TODAY)}
        </h1>
      </div>

      {/* Task List */}
      <section style={{ marginBottom: '20px' }}>
        <div style={{ ...card }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckCircle size={16} color="#8B9EC7" />
              <span style={{ ...sectionHeader }}>今日任務</span>
            </div>
            {totalTasks > 0 && (
              <span style={{ fontSize: '12px', color: '#AEAEB2' }}>
                {completedTasks}/{totalTasks} 完成
              </span>
            )}
          </div>
          {totalTasks === 0 ? (
            <p style={{ color: '#AEAEB2', fontSize: '14px', margin: 0 }}>尚無任務</p>
          ) : (
            <>
              <div style={{ height: '4px', backgroundColor: 'rgba(60,60,67,0.08)', borderRadius: '2px', overflow: 'hidden', marginBottom: '14px' }}>
                <div style={{ height: '100%', width: `${(completedTasks / totalTasks) * 100}%`, backgroundColor: '#8B9EC7', borderRadius: '2px', transition: 'width 0.3s ease' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {tasks.map((task, idx) => (
                  <div
                    key={task.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '12px 0',
                      ...(idx < tasks.length - 1 ? separator : {}),
                    }}
                  >
                    <button
                      onClick={() => toggleTask(task)}
                      style={{
                        width: '22px', height: '22px', borderRadius: '6px',
                        border: `1.5px solid ${task.completed ? '#8B9EC7' : '#AEAEB2'}`,
                        backgroundColor: task.completed ? '#8B9EC7' : 'transparent',
                        cursor: 'pointer', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                      }}
                    >
                      {task.completed && <span style={{ fontSize: '11px', color: '#fff' }}>✓</span>}
                    </button>
                    <span style={{
                      fontSize: '15px', color: task.completed ? '#AEAEB2' : '#1C1C1E',
                      textDecoration: task.completed ? 'line-through' : 'none', flex: 1, lineHeight: 1.4,
                    }}>
                      {task.title}
                    </span>
                    {task.carried_over && (
                      <span style={{ fontSize: '10px', color: '#f59e0b', flexShrink: 0 }}>↻</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Habit Quick Check */}
      <section style={{ marginBottom: '20px' }}>
        <div style={{ ...card }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <TrendingUp size={16} color="#5C7A6B" />
            <span style={{ ...sectionHeader }}>今日習慣</span>
          </div>
          {habitDefs.length === 0 ? (
            <p style={{ color: '#AEAEB2', fontSize: '14px', margin: 0 }}>尚無習慣</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {habitDefs.map((def, i) => {
                const done = isHabitDone(def.id)
                const color = HABIT_COLORS[i % HABIT_COLORS.length]
                return (
                  <button
                    key={def.id}
                    onClick={() => toggleHabitLog(def.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '12px 0',
                      backgroundColor: 'transparent',
                      border: 'none',
                      cursor: 'pointer', textAlign: 'left',
                      ...(i < habitDefs.length - 1 ? separator : {}),
                    }}
                  >
                    {done ? (
                      <CheckCircle size={20} color={color} style={{ flexShrink: 0 }} />
                    ) : (
                      <Circle size={20} color="#AEAEB2" style={{ flexShrink: 0 }} />
                    )}
                    <span style={{ fontSize: '15px', color: done ? color : '#6C6C70', fontWeight: '500', flex: 1 }}>
                      {def.name}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* Goals Progress */}
      {goals.filter(g => goalTasks.some(t => t.goal_id === g.id)).length > 0 && (
        <section style={{ marginBottom: '20px' }}>
          <div style={{ ...card }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <Target size={16} color="#8B9EC7" />
              <span style={{ ...sectionHeader }}>目標進度</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {goals.filter(g => goalTasks.some(t => t.goal_id === g.id)).map((goal, idx, arr) => {
                const tasks = goalTasks.filter(t => t.goal_id === goal.id)
                const done = tasks.filter(t => t.completed).length
                const pct = Math.round((done / tasks.length) * 100)
                const color = GOAL_CATEGORY_COLORS[goal.category] ?? '#6b7280'
                return (
                  <div key={goal.id} style={{
                    padding: '12px 0',
                    ...(idx < arr.length - 1 ? separator : {}),
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: color }} />
                        <span style={{ fontSize: '14px', color: '#1C1C1E' }}>
                          #{goal.position} {goal.title}
                        </span>
                      </div>
                      <span style={{ fontSize: '12px', color: '#AEAEB2' }}>
                        {done}/{tasks.length} · {pct}%
                      </span>
                    </div>
                    <div style={{ height: '4px', backgroundColor: 'rgba(60,60,67,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: `${pct}%`,
                        backgroundColor: color, borderRadius: '2px',
                        transition: 'width 0.3s',
                      }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {/* Bottom row: Expenses + Mood */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div style={{ ...card }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
            <span style={{ fontSize: '14px' }}>💰</span>
            <span style={{ fontSize: '12px', color: '#6C6C70' }}>今日支出</span>
          </div>
          <div style={{ fontSize: '24px', fontWeight: '700', color: totalExpenses > 0 ? '#d97706' : '#AEAEB2' }}>
            ${totalExpenses.toLocaleString()}
          </div>
          <div style={{ fontSize: '11px', color: '#AEAEB2', marginTop: '4px' }}>
            {expenses.length} 筆消費
          </div>
        </div>
        <div style={{ ...card }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
            <Zap size={14} color="#C4A5A5" />
            <span style={{ fontSize: '12px', color: '#6C6C70' }}>今日能量</span>
          </div>
          {mood ? (
            <>
              <div style={{ fontSize: '24px', fontWeight: '700', color: ENERGY_COLORS[mood.energy] }}>
                {mood.energy}/5
              </div>
              <div style={{ fontSize: '11px', color: '#AEAEB2', marginTop: '4px' }}>
                {ENERGY_LABELS[mood.energy]}
              </div>
            </>
          ) : (
            <div style={{ fontSize: '14px', color: '#AEAEB2', paddingTop: '4px' }}>未記錄</div>
          )}
        </div>
      </div>
    </div>
  )
}
