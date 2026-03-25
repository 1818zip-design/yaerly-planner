import { useEffect, useState } from 'react'
import { supabase, formatDateTW } from '../lib/supabase'
import type { Task, HabitDefinition, HabitLog, Expense, Mood, Journal } from '../types'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const DAYS_ZH = ['日', '一', '二', '三', '四', '五', '六']
const ENERGY_COLORS = ['#e5e5e5', '#ef4444', '#f97316', '#eab308', '#22c55e', '#6366f1']
const ENERGY_BG = ['#f5f5f5', '#fef2f2', '#fff7ed', '#fefce8', '#f0fdf4', '#eef2ff']

function getMonthRange(d: Date) {
  const y = d.getFullYear()
  const m = d.getMonth()
  const start = `${y}-${String(m + 1).padStart(2, '0')}-01`
  const lastDay = new Date(y, m + 1, 0).getDate()
  const end = `${y}-${String(m + 1).padStart(2, '0')}-${lastDay}`
  return { start, end, year: y, month: m, lastDay }
}

export default function Summary() {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }))
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [habitDefs, setHabitDefs] = useState<HabitDefinition[]>([])
  const [habitLogs, setHabitLogs] = useState<HabitLog[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [moods, setMoods] = useState<Mood[]>([])
  const [journals, setJournals] = useState<Journal[]>([])
  const [loading, setLoading] = useState(true)

  const { start, end, year, month, lastDay } = getMonthRange(currentMonth)
  const today = formatDateTW(new Date())

  useEffect(() => {
    fetchMonthData()
    setSelectedDate(null)
  }, [currentMonth])

  async function fetchMonthData() {
    setLoading(true)
    const [t, d, l, e, m, j] = await Promise.all([
      supabase.from('tasks').select('*').gte('date', start).lte('date', end),
      supabase.from('habit_definitions').select('*').order('created_at'),
      supabase.from('habit_logs').select('*').gte('date', start).lte('date', end),
      supabase.from('expenses').select('*').gte('date', start).lte('date', end),
      supabase.from('mood').select('*').gte('date', start).lte('date', end),
      supabase.from('journal').select('*').gte('date', start).lte('date', end),
    ])
    if (t.data) setTasks(t.data)
    if (d.data) setHabitDefs(d.data)
    if (l.data) setHabitLogs(l.data)
    if (e.data) setExpenses(e.data)
    if (m.data) setMoods(m.data)
    if (j.data) setJournals(j.data)
    setLoading(false)
  }

  function prevMonth() {
    setCurrentMonth(new Date(year, month - 1, 1))
  }
  function nextMonth() {
    setCurrentMonth(new Date(year, month + 1, 1))
  }

  // Build day data lookup
  function dayTasks(date: string) { return tasks.filter(t => t.date === date) }
  function dayMood(date: string) { return moods.find(m => m.date === date) }
  function dayExpenses(date: string) { return expenses.filter(e => e.date === date) }
  function dayHabitLogs(date: string) { return habitLogs.filter(l => l.date === date && l.completed) }
  function dayJournal(date: string) { return journals.find(j => j.date === date) }

  // Month summary stats
  const totalTasks = tasks.length
  const completedTasks = tasks.filter(t => t.completed).length
  const totalExpense = expenses.reduce((s, e) => s + e.amount, 0)
  const avgMood = moods.length > 0
    ? (moods.reduce((s, m) => s + m.energy, 0) / moods.length).toFixed(1)
    : '-'

  // Calendar grid
  const firstDayOfWeek = new Date(year, month, 1).getDay()
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null)
  for (let d = 1; d <= lastDay; d++) cells.push(d)

  const sel = selectedDate
  const selTasks = sel ? dayTasks(sel) : []
  const selMood = sel ? dayMood(sel) : null
  const selExpenses = sel ? dayExpenses(sel) : []
  const selHabits = sel ? dayHabitLogs(sel) : []
  const selJournal = sel ? dayJournal(sel) : null

  return (
    <div style={{ padding: '24px 16px 16px', maxWidth: '480px', margin: '0 auto' }}>
      {/* Month header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <button onClick={prevMonth} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: '4px' }}>
          <ChevronLeft size={20} />
        </button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: '700', color: '#1a1a1a' }}>
            {year} 年 {month + 1} 月
          </div>
          <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>
            {completedTasks}/{totalTasks} 任務 · ${totalExpense.toLocaleString()} · 心情 {avgMood}
          </div>
        </div>
        <button onClick={nextMonth} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: '4px' }}>
          <ChevronRight size={20} />
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: '#bbb', padding: '40px 0' }}>載入中...</div>
      ) : (
        <>
          {/* Calendar grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '16px' }}>
            {DAYS_ZH.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: '11px', color: '#999', padding: '4px 0' }}>{d}</div>
            ))}
            {cells.map((day, i) => {
              if (day === null) return <div key={`e${i}`} />
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const mood = dayMood(dateStr)
              const dt = dayTasks(dateStr)
              const completed = dt.filter(t => t.completed).length
              const total = dt.length
              const isToday = dateStr === today
              const isSelected = dateStr === selectedDate
              const bgColor = mood ? ENERGY_BG[mood.energy] : '#f9f9f9'
              const borderColor = mood ? ENERGY_COLORS[mood.energy] : '#e5e5e5'

              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                  style={{
                    aspectRatio: '1',
                    borderRadius: '10px',
                    border: isSelected ? `2px solid #7c3aed` : isToday ? `2px solid #333` : `1px solid ${borderColor}40`,
                    backgroundColor: bgColor,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '1px',
                    padding: '2px',
                    position: 'relative',
                  }}
                >
                  <span style={{ fontSize: '13px', fontWeight: isToday ? '700' : '500', color: '#333' }}>
                    {day}
                  </span>
                  {total > 0 && (
                    <span style={{ fontSize: '8px', color: completed === total ? '#22c55e' : '#999' }}>
                      {completed}/{total}
                    </span>
                  )}
                  {mood && (
                    <div style={{
                      width: '6px', height: '6px', borderRadius: '50%',
                      backgroundColor: ENERGY_COLORS[mood.energy],
                      position: 'absolute', bottom: '3px', right: '3px',
                    }} />
                  )}
                </button>
              )
            })}
          </div>

          {/* Selected day detail */}
          {sel && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a1a1a', padding: '4px 0' }}>
                {sel}
              </div>

              {/* Tasks */}
              {selTasks.length > 0 && (
                <div style={{ backgroundColor: '#f7f7f8', borderRadius: '12px', padding: '14px', border: '1px solid #ebebeb' }}>
                  <p style={{ fontSize: '11px', color: '#999', margin: '0 0 8px', fontWeight: '500' }}>任務</p>
                  {selTasks.map(t => (
                    <div key={t.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '4px 0' }}>
                      <span style={{ fontSize: '12px' }}>{t.completed ? '✅' : '⬜'}</span>
                      <span style={{
                        fontSize: '13px', color: t.completed ? '#bbb' : '#333',
                        textDecoration: t.completed ? 'line-through' : 'none',
                      }}>{t.title}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Journal */}
              {selJournal && (
                <div style={{ backgroundColor: '#f7f7f8', borderRadius: '12px', padding: '14px', border: '1px solid #ebebeb' }}>
                  <p style={{ fontSize: '11px', color: '#999', margin: '0 0 8px', fontWeight: '500' }}>日記</p>
                  <p style={{ fontSize: '13px', color: '#444', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {selJournal.content}
                  </p>
                </div>
              )}

              {/* Expenses */}
              {selExpenses.length > 0 && (
                <div style={{ backgroundColor: '#f7f7f8', borderRadius: '12px', padding: '14px', border: '1px solid #ebebeb' }}>
                  <p style={{ fontSize: '11px', color: '#999', margin: '0 0 8px', fontWeight: '500' }}>
                    花費 · ${selExpenses.reduce((s, e) => s + e.amount, 0).toLocaleString()}
                  </p>
                  {selExpenses.map(e => (
                    <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                      <span style={{ fontSize: '13px', color: '#444' }}>{e.title}</span>
                      <span style={{ fontSize: '13px', color: '#d97706' }}>${e.amount.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Habits */}
              {selHabits.length > 0 && (
                <div style={{ backgroundColor: '#f7f7f8', borderRadius: '12px', padding: '14px', border: '1px solid #ebebeb' }}>
                  <p style={{ fontSize: '11px', color: '#999', margin: '0 0 8px', fontWeight: '500' }}>習慣</p>
                  {selHabits.map(l => {
                    const def = habitDefs.find(d => d.id === l.habit_id)
                    return (
                      <div key={l.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '4px 0' }}>
                        <span style={{ fontSize: '12px' }}>✅</span>
                        <span style={{ fontSize: '13px', color: '#22c55e' }}>{def?.name || '習慣'}</span>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Mood */}
              {selMood && (
                <div style={{ backgroundColor: '#f7f7f8', borderRadius: '12px', padding: '14px', border: '1px solid #ebebeb' }}>
                  <p style={{ fontSize: '11px', color: '#999', margin: '0 0 8px', fontWeight: '500' }}>心情</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '20px', fontWeight: '700', color: ENERGY_COLORS[selMood.energy] }}>
                      {selMood.energy}/5
                    </span>
                    {selMood.tags.length > 0 && (
                      <span style={{ fontSize: '12px', color: '#888' }}>
                        {selMood.tags.join('、')}
                      </span>
                    )}
                  </div>
                  {selMood.note && (
                    <p style={{ fontSize: '12px', color: '#666', margin: '6px 0 0' }}>{selMood.note}</p>
                  )}
                </div>
              )}

              {/* Empty state */}
              {selTasks.length === 0 && !selJournal && selExpenses.length === 0 && selHabits.length === 0 && !selMood && (
                <div style={{ textAlign: 'center', color: '#ccc', fontSize: '13px', padding: '20px 0' }}>
                  這天沒有任何記錄
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
