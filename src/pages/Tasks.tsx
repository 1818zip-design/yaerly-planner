import { useEffect, useState } from 'react'
import { supabase, getToday, formatDateTW } from '../lib/supabase'
import type { Task, Goal } from '../types'
import { ChevronLeft, ChevronRight, Plus, Trash2, Tag, Pencil, Check, X } from 'lucide-react'

function formatDate(d: Date) {
  return formatDateTW(d)
}

function addDays(d: Date, n: number) {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + n)
  return copy
}

function displayDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  const today = formatDate(new Date())
  const tomorrow = formatDate(addDays(new Date(), 1))
  const yesterday = formatDate(addDays(new Date(), -1))
  if (dateStr === today) return '今天'
  if (dateStr === tomorrow) return '明天'
  if (dateStr === yesterday) return '昨天'
  return `${d.getMonth() + 1}/${d.getDate()}`
}

interface AddTaskModalProps {
  date: string
  goals: Goal[]
  onAdd: (task: Partial<Task>) => void
  onClose: () => void
}

const COMMON_TAGS = ['重要', '緊急', '工作', '學習', '健康', '生活', '社交']

function AddTaskModal({ date, goals, onAdd, onClose }: AddTaskModalProps) {
  const [title, setTitle] = useState('')
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [customTag, setCustomTag] = useState('')

  function toggleTag(tag: string) {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  function addCustomTag() {
    const t = customTag.trim()
    if (t && !tags.includes(t)) {
      setTags(prev => [...prev, t])
      setCustomTag('')
    }
  }

  function handleSubmit() {
    if (title.trim()) {
      onAdd({ title: title.trim(), time_slot: 'anytime', date, goal_id: selectedGoal, tags, completed: false, carried_over: false })
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '20px 20px 0 0',
          padding: '24px 20px',
          paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
          width: '100%',
          maxWidth: '480px',
          maxHeight: '85dvh',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          boxShadow: '0 -10px 40px rgba(0,0,0,0.12)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 20px', fontSize: '16px', color: '#1C1C1E' }}>新增任務</h3>

        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="任務名稱..."
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
          style={{
            width: '100%',
            padding: '12px',
            backgroundColor: 'rgba(118,118,128,0.12)',
            border: 'none',
            borderRadius: '10px',
            color: '#1C1C1E',
            fontSize: '15px',
            outline: 'none',
            marginBottom: '16px',
          }}
        />

        {/* Tags */}
        <p style={{ fontSize: '12px', color: '#6C6C70', marginBottom: '8px' }}>標籤</p>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
          {COMMON_TAGS.map(tag => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              style={{
                padding: '5px 10px',
                borderRadius: '20px',
                border: `1px solid ${tags.includes(tag) ? '#8B9EC7' : 'rgba(60,60,67,0.12)'}`,
                backgroundColor: tags.includes(tag) ? 'rgba(139,158,199,0.15)' : 'transparent',
                color: tags.includes(tag) ? '#8B9EC7' : '#6C6C70',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              {tag}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <input
            value={customTag}
            onChange={e => setCustomTag(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addCustomTag() }}
            placeholder="自訂標籤..."
            style={{
              flex: 1,
              padding: '8px 12px',
              backgroundColor: 'rgba(118,118,128,0.12)',
              border: 'none',
              borderRadius: '10px',
              color: '#1C1C1E',
              fontSize: '12px',
              outline: 'none',
            }}
          />
          <button
            onClick={addCustomTag}
            style={{
              padding: '8px 12px',
              backgroundColor: 'rgba(118,118,128,0.12)',
              border: 'none',
              borderRadius: '10px',
              color: '#6C6C70',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            <Tag size={14} />
          </button>
        </div>

        {/* Link to goal */}
        {goals.length > 0 && (
          <>
            <p style={{ fontSize: '12px', color: '#6C6C70', marginBottom: '8px' }}>連結年度目標（選填）</p>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '20px' }}>
              {goals.map(goal => (
                <button
                  key={goal.id}
                  onClick={() => setSelectedGoal(selectedGoal === goal.id ? null : goal.id)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '6px',
                    border: `1px solid ${selectedGoal === goal.id ? '#8B9EC7' : 'rgba(60,60,67,0.12)'}`,
                    backgroundColor: selectedGoal === goal.id ? 'rgba(139,158,199,0.15)' : 'transparent',
                    color: selectedGoal === goal.id ? '#8B9EC7' : '#6C6C70',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                >
                  #{goal.position} {goal.title}
                </button>
              ))}
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '13px', borderRadius: '12px',
              border: '1px solid rgba(60,60,67,0.12)', backgroundColor: 'transparent',
              color: '#6C6C70', fontSize: '14px', cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim()}
            style={{
              flex: 2, padding: '13px', borderRadius: '12px', border: 'none',
              backgroundColor: title.trim() ? '#8B9EC7' : 'rgba(118,118,128,0.12)',
              color: title.trim() ? '#fff' : '#AEAEB2',
              fontSize: '14px', fontWeight: '600',
              cursor: title.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            新增
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Tasks() {
  const [currentDate, setCurrentDate] = useState(formatDate(new Date()))
  const [tasks, setTasks] = useState<Task[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [carryOverChecked, setCarryOverChecked] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  useEffect(() => {
    fetchTasks()
  }, [currentDate])

  useEffect(() => {
    fetchGoals()
  }, [])

  // Auto carry-over: move ALL past incomplete tasks to today, then delete originals
  useEffect(() => {
    if (carryOverChecked) return
    const today = getToday()
    if (currentDate !== today) return

    async function carryOver() {
      // Fetch ALL incomplete tasks from any past date (before today)
      const { data: pastTasks } = await supabase
        .from('tasks').select('*')
        .lt('date', today)
        .eq('completed', false)

      if (!pastTasks || pastTasks.length === 0) {
        setCarryOverChecked(true)
        return
      }

      // Check what titles already exist today to avoid duplicates
      const { data: todayTasks } = await supabase
        .from('tasks').select('title')
        .eq('date', today)

      const todayTitles = new Set((todayTasks ?? []).map(t => t.title))

      const toCarry = pastTasks.filter(t => !todayTitles.has(t.title))

      if (toCarry.length > 0) {
        // Create new tasks for today
        const inserts = toCarry.map(t => ({
          title: t.title, date: today, time_slot: t.time_slot,
          completed: false, goal_id: t.goal_id, tags: t.tags,
          carried_over: true,
          original_date: t.original_date ?? t.date,
        }))
        const { data: created } = await supabase.from('tasks').insert(inserts).select()

        // Delete the originals
        const idsToDelete = toCarry.map(t => t.id)
        await supabase.from('tasks').delete().in('id', idsToDelete)

        if (created) setTasks(prev => [...prev, ...created])
      }

      setCarryOverChecked(true)
    }
    carryOver()
  }, [currentDate, carryOverChecked])

  async function fetchTasks() {
    setLoading(true)
    const { data } = await supabase.from('tasks').select('*').eq('date', currentDate).order('created_at')
    if (data) setTasks(data)
    setLoading(false)
  }

  async function fetchGoals() {
    const { data } = await supabase.from('goals').select('*').order('position')
    if (data) setGoals(data)
  }

  async function addTask(taskData: Partial<Task>) {
    const { data } = await supabase
      .from('tasks').insert({ ...taskData, date: currentDate }).select().single()
    if (data) setTasks(prev => [...prev, data])
    setShowAdd(false)
  }

  async function toggleTask(task: Task) {
    const { data } = await supabase
      .from('tasks').update({ completed: !task.completed }).eq('id', task.id).select().single()
    if (data) setTasks(prev => prev.map(t => (t.id === data.id ? data : t)))
  }

  async function deleteTask(id: string) {
    await supabase.from('tasks').delete().eq('id', id)
    setTasks(prev => prev.filter(t => t.id !== id))
  }

  function startEdit(task: Task) {
    setEditingId(task.id)
    setEditTitle(task.title)
  }

  async function saveEdit(id: string) {
    if (!editTitle.trim()) return
    const { data } = await supabase
      .from('tasks').update({ title: editTitle.trim() }).eq('id', id).select().single()
    if (data) setTasks(prev => prev.map(t => (t.id === data.id ? data : t)))
    setEditingId(null)
  }

  const completedCount = tasks.filter(t => t.completed).length

  return (
    <div style={{ padding: '24px 16px 16px', maxWidth: '480px', margin: '0 auto', backgroundColor: '#F2F2F7', minHeight: '100dvh' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <button
          onClick={() => setCurrentDate(formatDate(addDays(new Date(currentDate), -1)))}
          style={{ background: 'none', border: 'none', color: '#6C6C70', cursor: 'pointer', padding: '4px' }}
        >
          <ChevronLeft size={20} />
        </button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: '700', color: '#1C1C1E' }}>
            {displayDate(currentDate)}
          </div>
          <div style={{ fontSize: '11px', color: '#AEAEB2', marginTop: '2px' }}>
            {completedCount}/{tasks.length} 完成
          </div>
        </div>
        <button
          onClick={() => setCurrentDate(formatDate(addDays(new Date(currentDate), 1)))}
          style={{ background: 'none', border: 'none', color: '#6C6C70', cursor: 'pointer', padding: '4px' }}
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Add task button */}
      <button
        onClick={() => setShowAdd(true)}
        style={{
          width: '100%', padding: '12px', borderRadius: '14px',
          border: '1px dashed #AEAEB2', borderStyle: 'dashed', borderColor: '#AEAEB2',
          backgroundColor: 'transparent',
          color: '#AEAEB2', fontSize: '14px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '6px', marginBottom: '20px',
        }}
      >
        <Plus size={16} />
        新增任務
      </button>

      {loading ? (
        <div style={{ textAlign: 'center', color: '#AEAEB2', paddingTop: '40px' }}>載入中...</div>
      ) : tasks.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#AEAEB2', paddingTop: '40px', fontSize: '14px' }}>
          今天還沒有任務
        </div>
      ) : (
        <div style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '14px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          overflow: 'hidden',
        }}>
          {tasks.map((task, index) => (
            <div
              key={task.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                padding: '12px 14px',
                backgroundColor: '#FFFFFF',
                borderBottom: index < tasks.length - 1 ? '0.5px solid rgba(60,60,67,0.12)' : 'none',
              }}
            >
              <button
                onClick={() => toggleTask(task)}
                style={{
                  width: '20px', height: '20px', borderRadius: '6px',
                  border: `1.5px solid ${task.completed ? '#8B9EC7' : '#AEAEB2'}`,
                  backgroundColor: task.completed ? '#8B9EC7' : 'transparent',
                  cursor: 'pointer', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 0, marginTop: '1px',
                }}
              >
                {task.completed && <span style={{ fontSize: '10px', color: '#fff' }}>✓</span>}
              </button>

              <div style={{ flex: 1, minWidth: 0 }}>
                {editingId === task.id ? (
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input
                      autoFocus
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveEdit(task.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      style={{
                        flex: 1, padding: '4px 8px', fontSize: '14px',
                        border: 'none', borderRadius: '10px',
                        outline: 'none', color: '#1C1C1E',
                        backgroundColor: 'rgba(118,118,128,0.12)',
                      }}
                    />
                    <button
                      onClick={() => saveEdit(task.id)}
                      style={{ background: 'none', border: 'none', color: '#5C7A6B', cursor: 'pointer', padding: '2px' }}
                    >
                      <Check size={16} />
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      style={{ background: 'none', border: 'none', color: '#AEAEB2', cursor: 'pointer', padding: '2px' }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <p
                    style={{
                      margin: 0, fontSize: '14px',
                      color: task.completed ? '#AEAEB2' : '#1C1C1E',
                      textDecoration: task.completed ? 'line-through' : 'none',
                      lineHeight: 1.4,
                    }}
                  >
                    {task.title}
                  </p>
                )}

                {editingId !== task.id && (
                  <>
                    {task.tags.length > 0 && (
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' }}>
                        {task.tags.map(tag => (
                          <span
                            key={tag}
                            style={{
                              fontSize: '10px', color: '#6C6C70',
                              backgroundColor: 'rgba(118,118,128,0.12)', padding: '2px 7px',
                              borderRadius: '10px',
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {task.carried_over && (
                      <span style={{ fontSize: '10px', color: '#8B9EC7', marginTop: '4px', display: 'inline-block', marginRight: '8px' }}>
                        ↻ 順延
                      </span>
                    )}
                    {task.goal_id && (
                      <span style={{ fontSize: '10px', color: 'rgba(139,158,199,0.7)', marginTop: '4px', display: 'inline-block' }}>
                        ◆ {goals.find(g => g.id === task.goal_id)?.title ?? '目標'}
                      </span>
                    )}
                  </>
                )}
              </div>

              {editingId !== task.id && (
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                  <button
                    onClick={() => startEdit(task)}
                    style={{ background: 'none', border: 'none', color: '#AEAEB2', cursor: 'pointer', padding: '2px' }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => deleteTask(task.id)}
                    style={{ background: 'none', border: 'none', color: '#E57373', cursor: 'pointer', padding: '2px' }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddTaskModal
          date={currentDate}
          goals={goals}
          onAdd={addTask}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  )
}
