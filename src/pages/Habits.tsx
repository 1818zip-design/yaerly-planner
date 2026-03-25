import { useEffect, useState } from 'react'
import { supabase, getToday, formatDateTW } from '../lib/supabase'
import type { HabitDefinition, HabitLog } from '../types'
import { Plus, Trash2, CheckCircle, Circle, ChevronLeft, ChevronRight } from 'lucide-react'

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay()
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function addDays(d: Date, n: number) {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + n)
  return copy
}

function displayDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  const today = getToday()
  const days = ['日', '一', '二', '三', '四', '五', '六']
  if (dateStr === today) return `今天 · ${d.getMonth() + 1}/${d.getDate()} (週${days[d.getDay()]})`
  return `${d.getMonth() + 1}/${d.getDate()} (週${days[d.getDay()]})`
}

const HABIT_COLORS = ['#5C7A6B', '#8B9EC7', '#C4956A', '#B07AA1', '#7BA3A3', '#A1887F', '#82A47D', '#C78B8B']

export default function Habits() {
  const today = getToday()
  const [selectedDate, setSelectedDate] = useState(today)
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }))
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [definitions, setDefinitions] = useState<HabitDefinition[]>([])
  const [logs, setLogs] = useState<HabitLog[]>([])
  const [loading, setLoading] = useState(true)
  const [newHabitName, setNewHabitName] = useState('')
  const [activeHabitId, setActiveHabitId] = useState<string | null>(null)

  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()

  useEffect(() => {
    fetchAll()
  }, [year, month])

  async function fetchAll() {
    setLoading(true)
    const startDate = `${year}-${pad(month + 1)}-01`
    const endDate = `${year}-${pad(month + 1)}-${pad(getDaysInMonth(year, month))}`

    const [defsRes, logsRes] = await Promise.all([
      supabase.from('habit_definitions').select('*').order('created_at'),
      supabase.from('habit_logs').select('*').gte('date', startDate).lte('date', endDate),
    ])

    if (defsRes.data) {
      setDefinitions(defsRes.data)
      if (!activeHabitId && defsRes.data.length > 0) {
        setActiveHabitId(defsRes.data[0].id)
      }
    }
    if (logsRes.data) setLogs(logsRes.data)
    setLoading(false)
  }

  async function addHabit() {
    const name = newHabitName.trim()
    if (!name) return
    const { data } = await supabase
      .from('habit_definitions').insert({ name }).select().single()
    if (data) {
      setDefinitions(prev => [...prev, data])
      if (!activeHabitId) setActiveHabitId(data.id)
    }
    setNewHabitName('')
  }

  async function deleteHabit(id: string) {
    await supabase.from('habit_definitions').delete().eq('id', id)
    setDefinitions(prev => prev.filter(d => d.id !== id))
    setLogs(prev => prev.filter(l => l.habit_id !== id))
    if (activeHabitId === id) {
      const remaining = definitions.filter(d => d.id !== id)
      setActiveHabitId(remaining.length > 0 ? remaining[0].id : null)
    }
  }

  async function toggleHabitLog(habitId: string, date: string) {
    const existing = logs.find(l => l.habit_id === habitId && l.date === date)
    if (existing) {
      if (existing.completed) {
        await supabase.from('habit_logs').delete().eq('id', existing.id)
        setLogs(prev => prev.filter(l => l.id !== existing.id))
      } else {
        const { data } = await supabase
          .from('habit_logs').update({ completed: true }).eq('id', existing.id).select().single()
        if (data) setLogs(prev => prev.map(l => l.id === data.id ? data : l))
      }
    } else {
      const { data } = await supabase
        .from('habit_logs')
        .insert({ date, habit_id: habitId, completed: true, note: '' })
        .select().single()
      if (data) setLogs(prev => [...prev, data])
    }
  }

  function isCompleted(habitId: string, date: string) {
    return logs.some(l => l.habit_id === habitId && l.date === date && l.completed)
  }

  function calcStreak(habitId: string) {
    let streak = 0
    const d = new Date(today + 'T00:00:00')
    while (true) {
      const dateStr = formatDateTW(d)
      const log = logs.find(l => l.habit_id === habitId && l.date === dateStr && l.completed)
      if (log) {
        streak++
        d.setDate(d.getDate() - 1)
      } else {
        break
      }
    }
    return streak
  }

  function calcMonthlyRate(habitId: string) {
    const daysInMonth = getDaysInMonth(year, month)
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }))
    const daysPassed = now.getMonth() === month && now.getFullYear() === year
      ? now.getDate()
      : daysInMonth
    const done = logs.filter(l => l.habit_id === habitId && l.completed).length
    return daysPassed > 0 ? Math.round((done / daysPassed) * 100) : 0
  }

  function getColor(index: number) {
    return HABIT_COLORS[index % HABIT_COLORS.length]
  }

  function prevDay() {
    const d = addDays(new Date(selectedDate + 'T00:00:00'), -1)
    const ds = formatDateTW(d)
    setSelectedDate(ds)
    // Switch month if needed
    if (d.getMonth() !== month || d.getFullYear() !== year) {
      setCurrentMonth(new Date(d.getFullYear(), d.getMonth(), 1))
    }
  }

  function nextDay() {
    const d = addDays(new Date(selectedDate + 'T00:00:00'), 1)
    const ds = formatDateTW(d)
    setSelectedDate(ds)
    if (d.getMonth() !== month || d.getFullYear() !== year) {
      setCurrentMonth(new Date(d.getFullYear(), d.getMonth(), 1))
    }
  }

  function selectCalendarDay(day: number) {
    const ds = `${year}-${pad(month + 1)}-${pad(day)}`
    setSelectedDate(ds)
  }

  // Calendar heatmap
  const daysInMonth = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfMonth(year, month)
  const calendarCells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (calendarCells.length % 7 !== 0) calendarCells.push(null)

  const DAYS_LABEL = ['日', '一', '二', '三', '四', '五', '六']

  const activeIndex = definitions.findIndex(d => d.id === activeHabitId)
  const activeColor = activeIndex >= 0 ? getColor(activeIndex) : '#5C7A6B'

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80dvh', color: '#AEAEB2' }}>
        載入中...
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 16px', maxWidth: '480px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#1C1C1E', margin: '0 0 20px' }}>
        習慣追蹤
      </h1>

      {/* Add new habit */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        <input
          value={newHabitName}
          onChange={e => setNewHabitName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addHabit() }}
          placeholder="新增習慣..."
          style={{
            flex: 1, padding: '10px 12px', backgroundColor: 'rgba(118,118,128,0.12)',
            border: 'none', borderRadius: '10px',
            color: '#1C1C1E', fontSize: '14px', outline: 'none',
          }}
        />
        <button
          onClick={addHabit}
          disabled={!newHabitName.trim()}
          style={{
            padding: '10px 16px', borderRadius: '10px', border: 'none',
            backgroundColor: newHabitName.trim() ? '#8B9EC7' : 'rgba(118,118,128,0.12)',
            color: newHabitName.trim() ? '#fff' : '#AEAEB2',
            cursor: newHabitName.trim() ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: '600',
          }}
        >
          <Plus size={15} />
        </button>
      </div>

      {definitions.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#AEAEB2', paddingTop: '40px', fontSize: '14px' }}>
          還沒有習慣，新增一個吧
        </div>
      ) : (
        <>
          {/* Date navigation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <button onClick={prevDay} style={{ background: 'none', border: 'none', color: '#8B9EC7', cursor: 'pointer', padding: '4px' }}>
              <ChevronLeft size={20} />
            </button>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '15px', fontWeight: '600', color: '#1C1C1E' }}>
                {displayDate(selectedDate)}
              </div>
              {selectedDate !== today && (
                <button
                  onClick={() => setSelectedDate(today)}
                  style={{ background: 'none', border: 'none', color: '#8B9EC7', fontSize: '11px', cursor: 'pointer', padding: '2px 0' }}
                >
                  回到今天
                </button>
              )}
            </div>
            <button
              onClick={nextDay}
              disabled={selectedDate >= today}
              style={{
                background: 'none', border: 'none',
                color: selectedDate >= today ? '#AEAEB2' : '#8B9EC7',
                cursor: selectedDate >= today ? 'not-allowed' : 'pointer', padding: '4px',
              }}
            >
              <ChevronRight size={20} />
            </button>
          </div>

          {/* Habit check-in for selected date */}
          <div style={{ marginBottom: '28px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {definitions.map((def) => {
                const done = isCompleted(def.id, selectedDate)
                return (
                  <div
                    key={def.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '14px 16px', borderRadius: '14px',
                      backgroundColor: done ? '#5C7A6B0D' : '#FFFFFF',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                    }}
                  >
                    <button
                      onClick={() => toggleHabitLog(def.id, selectedDate)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: 0, display: 'flex', flexShrink: 0,
                      }}
                    >
                      {done ? (
                        <CheckCircle size={22} color="#5C7A6B" />
                      ) : (
                        <Circle size={22} color="#AEAEB2" />
                      )}
                    </button>
                    <span style={{ fontSize: '14px', fontWeight: '500', color: done ? '#5C7A6B' : '#1C1C1E', flex: 1 }}>
                      {def.name}
                    </span>
                    <button
                      onClick={() => deleteHabit(def.id)}
                      style={{ background: 'none', border: 'none', color: '#AEAEB2', cursor: 'pointer', padding: '2px' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Streak & Rate stats */}
          <div style={{ marginBottom: '28px' }}>
            <p style={{ fontSize: '12px', color: '#6C6C70', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>本月統計</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {definitions.map((def, i) => {
                const streak = calcStreak(def.id)
                const rate = calcMonthlyRate(def.id)
                const color = getColor(i)
                return (
                  <div
                    key={def.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '12px 16px', backgroundColor: '#FFFFFF',
                      borderRadius: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                    }}
                  >
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
                    <span style={{ fontSize: '13px', color: '#6C6C70', flex: 1 }}>{def.name}</span>
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '16px', fontWeight: '700', color: '#1C1C1E' }}>{streak}</div>
                        <div style={{ fontSize: '9px', color: '#AEAEB2' }}>連續天</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '16px', fontWeight: '700', color: '#1C1C1E' }}>{rate}%</div>
                        <div style={{ fontSize: '9px', color: '#AEAEB2' }}>完成率</div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Heatmap Calendar */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <button
                onClick={() => setCurrentMonth(new Date(year, month - 1, 1))}
                style={{ background: 'none', border: 'none', color: '#AEAEB2', cursor: 'pointer', padding: '4px' }}
              >
                <ChevronLeft size={16} />
              </button>
              <p style={{ fontSize: '12px', color: '#6C6C70', margin: 0, fontWeight: '600' }}>
                {year} 年 {month + 1} 月
              </p>
              <button
                onClick={() => setCurrentMonth(new Date(year, month + 1, 1))}
                style={{ background: 'none', border: 'none', color: '#AEAEB2', cursor: 'pointer', padding: '4px' }}
              >
                <ChevronRight size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
              {definitions.map((def) => (
                <button
                  key={def.id}
                  onClick={() => setActiveHabitId(def.id)}
                  style={{
                    padding: '4px 10px', borderRadius: '20px',
                    border: 'none',
                    backgroundColor: activeHabitId === def.id ? '#8B9EC7' : 'rgba(118,118,128,0.12)',
                    color: activeHabitId === def.id ? '#FFFFFF' : '#6C6C70',
                    fontSize: '11px', cursor: 'pointer', fontWeight: activeHabitId === def.id ? '600' : '400',
                  }}
                >
                  {def.name.length > 4 ? def.name.slice(0, 4) + '…' : def.name}
                </button>
              ))}
            </div>

            <div style={{
              backgroundColor: '#FFFFFF', borderRadius: '14px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)', padding: '16px',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                {DAYS_LABEL.map(d => (
                  <div key={d} style={{ textAlign: 'center', fontSize: '10px', color: '#AEAEB2', paddingBottom: '4px', fontWeight: '500' }}>
                    {d}
                  </div>
                ))}
                {calendarCells.map((day, i) => {
                  if (day === null) return <div key={`empty-${i}`} />
                  const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`
                  const done = activeHabitId
                    ? logs.some(l => l.habit_id === activeHabitId && l.date === dateStr && l.completed)
                    : false
                  const isToday = dateStr === today
                  const isSelected = dateStr === selectedDate
                  return (
                    <button
                      key={day}
                      onClick={() => selectCalendarDay(day)}
                      style={{
                        aspectRatio: '1', borderRadius: '8px',
                        backgroundColor: done ? activeColor + '30' : '#F2F2F7',
                        border: isSelected ? `2px solid #8B9EC7` : isToday ? `2px solid ${activeColor}` : '2px solid transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '11px', color: done ? activeColor : '#AEAEB2',
                        fontWeight: isToday || isSelected ? '700' : '400',
                        cursor: 'pointer', padding: 0,
                      }}
                    >
                      {day}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
