import { useEffect, useState } from 'react'
import { supabase, getToday } from '../lib/supabase'
import type { HabitDefinition, HabitLog } from '../types'
import { Plus, Trash2, CheckCircle, Circle } from 'lucide-react'

const TODAY = getToday()

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay()
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

const HABIT_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444', '#f97316']

export default function Habits() {
  const [year] = useState(() => parseInt(TODAY.slice(0, 4)))
  const [month] = useState(() => parseInt(TODAY.slice(5, 7)) - 1)
  const [definitions, setDefinitions] = useState<HabitDefinition[]>([])
  const [logs, setLogs] = useState<HabitLog[]>([])
  const [loading, setLoading] = useState(true)
  const [newHabitName, setNewHabitName] = useState('')
  const [activeHabitId, setActiveHabitId] = useState<string | null>(null)

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

  async function toggleHabitLog(habitId: string) {
    const existing = logs.find(l => l.habit_id === habitId && l.date === TODAY)
    if (existing) {
      if (existing.completed) {
        // Uncheck: delete the log
        await supabase.from('habit_logs').delete().eq('id', existing.id)
        setLogs(prev => prev.filter(l => l.id !== existing.id))
      } else {
        // Mark complete
        const { data } = await supabase
          .from('habit_logs').update({ completed: true }).eq('id', existing.id).select().single()
        if (data) setLogs(prev => prev.map(l => l.id === data.id ? data : l))
      }
    } else {
      // Create new log
      const { data } = await supabase
        .from('habit_logs')
        .insert({ date: TODAY, habit_id: habitId, completed: true, note: '' })
        .select().single()
      if (data) setLogs(prev => [...prev, data])
    }
  }

  function isCompletedToday(habitId: string) {
    return logs.some(l => l.habit_id === habitId && l.date === TODAY && l.completed)
  }

  function calcStreak(habitId: string) {
    let streak = 0
    const d = new Date(TODAY + 'T00:00:00')
    while (true) {
      const dateStr = d.toISOString().slice(0, 10)
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
    const today = new Date()
    const daysPassed = today.getMonth() === month && today.getFullYear() === year
      ? today.getDate()
      : daysInMonth
    const done = logs.filter(l => l.habit_id === habitId && l.completed).length
    return daysPassed > 0 ? Math.round((done / daysPassed) * 100) : 0
  }

  function getColor(index: number) {
    return HABIT_COLORS[index % HABIT_COLORS.length]
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
  const activeColor = activeIndex >= 0 ? getColor(activeIndex) : '#22c55e'

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80dvh', color: '#999' }}>
        載入中...
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 16px', maxWidth: '480px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#1a1a1a', margin: '0 0 24px' }}>
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
            flex: 1, padding: '10px 12px', backgroundColor: '#f7f7f8',
            border: '1px solid #e5e5e5', borderRadius: '10px',
            color: '#1a1a1a', fontSize: '14px', outline: 'none',
          }}
        />
        <button
          onClick={addHabit}
          disabled={!newHabitName.trim()}
          style={{
            padding: '10px 16px', borderRadius: '10px', border: 'none',
            backgroundColor: newHabitName.trim() ? '#7c3aed' : '#e5e5e5',
            color: newHabitName.trim() ? '#fff' : '#999',
            cursor: newHabitName.trim() ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: '600',
          }}
        >
          <Plus size={15} />
        </button>
      </div>

      {definitions.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#bbb', paddingTop: '40px', fontSize: '14px' }}>
          還沒有習慣，新增一個吧
        </div>
      ) : (
        <>
          {/* Today's habits */}
          <div style={{ marginBottom: '28px' }}>
            <p style={{ fontSize: '12px', color: '#999', margin: '0 0 12px' }}>今日打卡</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {definitions.map((def, i) => {
                const done = isCompletedToday(def.id)
                const color = getColor(i)
                return (
                  <div
                    key={def.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '14px 16px', borderRadius: '14px',
                      border: `1.5px solid ${done ? color + '55' : '#e5e5e5'}`,
                      backgroundColor: done ? color + '08' : '#f7f7f8',
                    }}
                  >
                    <button
                      onClick={() => toggleHabitLog(def.id)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: 0, display: 'flex', flexShrink: 0,
                      }}
                    >
                      {done ? (
                        <CheckCircle size={22} color={color} />
                      ) : (
                        <Circle size={22} color="#ccc" />
                      )}
                    </button>
                    <span style={{ fontSize: '14px', fontWeight: '500', color: done ? color : '#555', flex: 1 }}>
                      {def.name}
                    </span>
                    <button
                      onClick={() => deleteHabit(def.id)}
                      style={{ background: 'none', border: 'none', color: '#ddd', cursor: 'pointer', padding: '2px' }}
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
            <p style={{ fontSize: '12px', color: '#999', margin: '0 0 12px' }}>本月統計</p>
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
                      padding: '12px 16px', backgroundColor: '#f7f7f8',
                      borderRadius: '12px', border: '1px solid #ebebeb',
                    }}
                  >
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
                    <span style={{ fontSize: '13px', color: '#666', flex: 1 }}>{def.name}</span>
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '16px', fontWeight: '700', color }}>{streak}</div>
                        <div style={{ fontSize: '9px', color: '#999' }}>連續天</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '16px', fontWeight: '700', color }}>{rate}%</div>
                        <div style={{ fontSize: '9px', color: '#999' }}>完成率</div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Heatmap Calendar */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <p style={{ fontSize: '12px', color: '#999', margin: 0 }}>月曆熱圖</p>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {definitions.map((def, i) => (
                  <button
                    key={def.id}
                    onClick={() => setActiveHabitId(def.id)}
                    style={{
                      padding: '4px 10px', borderRadius: '20px',
                      border: `1px solid ${activeHabitId === def.id ? getColor(i) : '#e5e5e5'}`,
                      backgroundColor: activeHabitId === def.id ? getColor(i) + '15' : 'transparent',
                      color: activeHabitId === def.id ? getColor(i) : '#999',
                      fontSize: '11px', cursor: 'pointer',
                    }}
                  >
                    {def.name.length > 4 ? def.name.slice(0, 4) + '…' : def.name}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
              {DAYS_LABEL.map(d => (
                <div key={d} style={{ textAlign: 'center', fontSize: '10px', color: '#999', paddingBottom: '4px' }}>
                  {d}
                </div>
              ))}
              {calendarCells.map((day, i) => {
                if (day === null) return <div key={`empty-${i}`} />
                const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`
                const done = activeHabitId
                  ? logs.some(l => l.habit_id === activeHabitId && l.date === dateStr && l.completed)
                  : false
                const isToday = dateStr === TODAY
                return (
                  <div
                    key={day}
                    style={{
                      aspectRatio: '1', borderRadius: '6px',
                      backgroundColor: done ? activeColor + '30' : '#f7f7f8',
                      border: isToday ? `1.5px solid ${activeColor}` : '1px solid transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '11px', color: done ? activeColor : '#bbb',
                      fontWeight: isToday ? '700' : '400',
                    }}
                  >
                    {day}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
