import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Goal, Task } from '../types'
import { CheckCircle, Circle } from 'lucide-react'

const CATEGORY_COLORS: Record<string, string> = {
  健康: '#22c55e',
  學習: '#3b82f6',
  工作: '#f59e0b',
  關係: '#ec4899',
  財務: '#10b981',
  創作: '#8b5cf6',
  旅遊: '#06b6d4',
  生活: '#f97316',
  其他: '#6b7280',
}

const CATEGORIES = Object.keys(CATEGORY_COLORS)

function getCategoryColor(category: string) {
  return CATEGORY_COLORS[category] ?? '#6b7280'
}

interface EditModalProps {
  goal: Partial<Goal> & { position: number }
  allGoals: Goal[]
  relatedTasks: Task[]
  onSave: (data: Partial<Goal>) => void
  onClose: () => void
}

function EditModal({ goal, allGoals, relatedTasks, onSave, onClose }: EditModalProps) {
  const [title, setTitle] = useState(goal.title ?? '')
  const [category, setCategory] = useState(goal.category ?? '其他')
  const [connections, setConnections] = useState<string[]>(goal.connections ?? [])

  const otherGoals = allGoals.filter(g => g.position !== goal.position)
  const completedRelated = relatedTasks.filter(t => t.completed).length

  function toggleConnection(id: string) {
    setConnections(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    )
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100, padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#ffffff', borderRadius: '20px', padding: '24px',
          width: '100%', maxWidth: '400px', border: '1px solid #e5e5e5',
          maxHeight: '85dvh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 20px', fontSize: '16px', color: '#1a1a1a' }}>
          目標 #{goal.position}
        </h3>

        <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', color: '#888' }}>
          目標名稱
        </label>
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="輸入目標..."
          style={{
            width: '100%', padding: '10px 12px', backgroundColor: '#f7f7f8',
            border: '1px solid #e5e5e5', borderRadius: '10px', color: '#1a1a1a',
            fontSize: '14px', outline: 'none', marginBottom: '16px',
          }}
        />

        <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', color: '#888' }}>
          類別
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              style={{
                padding: '6px 12px', borderRadius: '20px',
                border: `1px solid ${category === cat ? getCategoryColor(cat) : '#e5e5e5'}`,
                backgroundColor: category === cat ? `${getCategoryColor(cat)}15` : 'transparent',
                color: category === cat ? getCategoryColor(cat) : '#888',
                fontSize: '12px', cursor: 'pointer',
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Connections */}
        {otherGoals.length > 0 && (
          <>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', color: '#888' }}>
              關聯目標（選填）
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '20px' }}>
              {otherGoals.map(g => {
                const selected = connections.includes(g.id)
                const color = getCategoryColor(g.category)
                return (
                  <button
                    key={g.id}
                    onClick={() => toggleConnection(g.id)}
                    style={{
                      padding: '5px 10px', borderRadius: '8px',
                      border: `1px solid ${selected ? color : '#e5e5e5'}`,
                      backgroundColor: selected ? color + '15' : 'transparent',
                      color: selected ? color : '#888', fontSize: '11px', cursor: 'pointer',
                    }}
                  >
                    #{g.position} {g.title}
                  </button>
                )
              })}
            </div>
          </>
        )}

        {/* Related tasks */}
        {goal.id && (
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', color: '#888' }}>
              相關任務
              {relatedTasks.length > 0 && (
                <span style={{ marginLeft: '8px', color: '#7c3aed' }}>
                  {completedRelated}/{relatedTasks.length} 完成
                </span>
              )}
            </label>
            {relatedTasks.length === 0 ? (
              <p style={{ fontSize: '13px', color: '#ccc', margin: 0 }}>尚無關聯任務</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto' }}>
                {relatedTasks.map(task => (
                  <div
                    key={task.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '8px 10px', backgroundColor: '#f7f7f8',
                      borderRadius: '8px', border: '1px solid #ebebeb',
                    }}
                  >
                    {task.completed ? (
                      <CheckCircle size={14} color="#7c3aed" style={{ flexShrink: 0 }} />
                    ) : (
                      <Circle size={14} color="#ccc" style={{ flexShrink: 0 }} />
                    )}
                    <span style={{
                      fontSize: '13px', flex: 1,
                      color: task.completed ? '#bbb' : '#444',
                      textDecoration: task.completed ? 'line-through' : 'none',
                    }}>
                      {task.title}
                    </span>
                    <span style={{ fontSize: '10px', color: '#bbb', flexShrink: 0 }}>
                      {task.date}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {relatedTasks.length > 0 && (
              <div style={{
                marginTop: '8px', height: '3px', backgroundColor: '#e5e5e5',
                borderRadius: '2px', overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${(completedRelated / relatedTasks.length) * 100}%`,
                  backgroundColor: '#7c3aed', borderRadius: '2px',
                  transition: 'width 0.3s',
                }} />
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '12px', borderRadius: '10px',
              border: '1px solid #e5e5e5', backgroundColor: 'transparent',
              color: '#888', fontSize: '14px', cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            onClick={() => {
              if (title.trim()) onSave({ title: title.trim(), category, connections })
            }}
            disabled={!title.trim()}
            style={{
              flex: 1, padding: '12px', borderRadius: '10px', border: 'none',
              backgroundColor: title.trim() ? '#7c3aed' : '#e5e5e5',
              color: title.trim() ? '#fff' : '#999',
              fontSize: '14px', fontWeight: '600',
              cursor: title.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            儲存
          </button>
        </div>
      </div>
    </div>
  )
}

interface ConnectionLine {
  x1: number; y1: number; x2: number; y2: number; color: string
}

export default function Goals() {
  const [goals, setGoals] = useState<Goal[]>([])
  const [allTasks, setAllTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [editingPosition, setEditingPosition] = useState<number | null>(null)
  const [connectionLines, setConnectionLines] = useState<ConnectionLine[]>([])
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const cellRefs = useRef<(HTMLDivElement | null)[]>(Array(20).fill(null))

  useEffect(() => {
    fetchGoals()
    fetchAllTasks()
  }, [])

  async function fetchGoals() {
    const { data, error } = await supabase.from('goals').select('*').order('position')
    if (error) console.error('fetchGoals error:', error)
    if (data) setGoals(data)
    setLoading(false)
  }

  async function fetchAllTasks() {
    const { data } = await supabase
      .from('tasks').select('*')
      .not('goal_id', 'is', null)
      .order('date', { ascending: false })
    if (data) setAllTasks(data)
  }

  function getTasksForGoal(goalId: string) {
    return allTasks.filter(t => t.goal_id === goalId)
  }

  // Draw SVG connection lines
  const updateConnectionLines = useCallback(() => {
    if (!containerRef.current || goals.length === 0) {
      setConnectionLines([])
      return
    }
    const containerRect = containerRef.current.getBoundingClientRect()
    const lines: ConnectionLine[] = []
    const drawn = new Set<string>()

    for (const goal of goals) {
      if (!goal.connections || goal.connections.length === 0) continue
      const fromCell = cellRefs.current[goal.position - 1]
      if (!fromCell) continue
      const fromRect = fromCell.getBoundingClientRect()
      const fromX = fromRect.left + fromRect.width / 2 - containerRect.left
      const fromY = fromRect.top + fromRect.height / 2 - containerRect.top

      for (const connId of goal.connections) {
        const connGoal = goals.find(g => g.id === connId)
        if (!connGoal) continue
        const key = [goal.id, connId].sort().join('-')
        if (drawn.has(key)) continue
        drawn.add(key)

        const toCell = cellRefs.current[connGoal.position - 1]
        if (!toCell) continue
        const toRect = toCell.getBoundingClientRect()
        lines.push({
          x1: fromX, y1: fromY,
          x2: toRect.left + toRect.width / 2 - containerRect.left,
          y2: toRect.top + toRect.height / 2 - containerRect.top,
          color: getCategoryColor(goal.category),
        })
      }
    }
    setConnectionLines(lines)
  }, [goals])

  useEffect(() => {
    const timer = setTimeout(updateConnectionLines, 100)
    window.addEventListener('resize', updateConnectionLines)
    return () => { clearTimeout(timer); window.removeEventListener('resize', updateConnectionLines) }
  }, [updateConnectionLines])

  function getGoalAtPosition(pos: number) {
    return goals.find(g => g.position === pos)
  }

  async function handleSave(position: number, data: Partial<Goal>) {
    const safeCategory = data.category && data.category.trim() ? data.category : '其他'
    const existing = getGoalAtPosition(position)
    if (existing) {
      const { data: updated, error } = await supabase
        .from('goals').update({ ...data, category: safeCategory })
        .eq('id', existing.id).select().single()
      if (error) console.error('update goal error:', error)
      if (updated) setGoals(prev => prev.map(g => (g.id === updated.id ? updated : g)))
    } else {
      const { data: created, error } = await supabase
        .from('goals')
        .insert({ position, title: data.title || '', category: safeCategory, completed: false, connections: data.connections || [] })
        .select().single()
      if (error) console.error('insert goal error:', error)
      if (created) setGoals(prev => [...prev, created])
    }
    setEditingPosition(null)
  }

  async function toggleComplete(goal: Goal) {
    const newCompleted = !goal.completed
    const { data } = await supabase
      .from('goals')
      .update({ completed: newCompleted, completed_at: newCompleted ? new Date().toISOString() : null })
      .eq('id', goal.id).select().single()
    if (data) setGoals(prev => prev.map(g => (g.id === data.id ? data : g)))
  }

  const completedCount = goals.filter(g => g.completed).length
  const editingGoal = editingPosition !== null
    ? getGoalAtPosition(editingPosition) ?? { position: editingPosition }
    : null

  // Get related tasks for the editing goal
  const editingRelatedTasks = editingGoal && 'id' in editingGoal && editingGoal.id
    ? getTasksForGoal(editingGoal.id as string)
    : []

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80dvh', color: '#999' }}>
        載入中...
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 16px', maxWidth: '480px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#1a1a1a', margin: 0 }}>
          2026 年度目標
        </h1>
        <span style={{ fontSize: '14px', color: '#7c3aed', fontWeight: '600' }}>
          {completedCount} / 20
        </span>
      </div>

      <div style={{ height: '3px', backgroundColor: '#e5e5e5', borderRadius: '2px', marginBottom: '24px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${(completedCount / 20) * 100}%`, backgroundColor: '#7c3aed', borderRadius: '2px', transition: 'width 0.4s ease' }} />
      </div>

      <div ref={containerRef} style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
        <svg ref={svgRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3 }}>
          {connectionLines.map((line, i) => (
            <line key={i} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
              stroke={line.color} strokeWidth="2" strokeOpacity="0.5" strokeDasharray="4 4" />
          ))}
        </svg>

        {Array.from({ length: 20 }, (_, i) => i + 1).map(pos => {
          const goal = getGoalAtPosition(pos)
          const color = goal ? getCategoryColor(goal.category) : '#e5e5e5'
          const isCompleted = goal?.completed ?? false
          // Task-based progress indicator
          const goalTasks = goal ? getTasksForGoal(goal.id) : []
          const hasProgress = goalTasks.length > 0
          const progressPct = hasProgress
            ? (goalTasks.filter(t => t.completed).length / goalTasks.length) * 100
            : 0

          return (
            <div
              key={pos}
              ref={el => { cellRefs.current[pos - 1] = el }}
              style={{
                position: 'relative', aspectRatio: '1', borderRadius: '14px',
                border: `1px solid ${goal ? color + '55' : '#e5e5e5'}`,
                backgroundColor: isCompleted ? '#1a1a1a' : (goal ? color + '10' : '#f7f7f8'),
                cursor: 'pointer', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', padding: '8px',
                overflow: 'hidden', transition: 'all 0.2s', zIndex: 2,
              }}
              onClick={() => setEditingPosition(pos)}
            >
              {isCompleted && (
                <div
                  style={{
                    position: 'absolute', inset: 0, backgroundColor: '#1a1a1a',
                    borderRadius: '13px', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', zIndex: 2,
                  }}
                  onClick={e => { e.stopPropagation(); toggleComplete(goal!) }}
                >
                  <span style={{ fontSize: '20px', color: '#fff' }}>✓</span>
                </div>
              )}

              <span style={{ position: 'absolute', top: '6px', left: '8px', fontSize: '10px', color: '#bbb', fontWeight: '500' }}>
                {pos}
              </span>

              {goal ? (
                <>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: color, marginBottom: '6px', flexShrink: 0 }} />
                  <p style={{
                    fontSize: '11px', fontWeight: '500', color: '#444', margin: 0,
                    textAlign: 'center', lineHeight: 1.3, wordBreak: 'break-all',
                    display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>
                    {goal.title}
                  </p>
                  {/* Task progress bar at bottom */}
                  {hasProgress && !isCompleted && (
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      height: '3px', backgroundColor: color + '20',
                    }}>
                      <div style={{
                        height: '100%', width: `${progressPct}%`,
                        backgroundColor: color, transition: 'width 0.3s',
                      }} />
                    </div>
                  )}
                  {!isCompleted && !hasProgress && (
                    <button
                      onClick={e => { e.stopPropagation(); toggleComplete(goal) }}
                      style={{
                        position: 'absolute', bottom: '5px', right: '5px',
                        width: '16px', height: '16px', borderRadius: '50%',
                        border: `1px solid ${color}66`, backgroundColor: 'transparent',
                        cursor: 'pointer', padding: 0, display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <span style={{ fontSize: '8px', color }}>✓</span>
                    </button>
                  )}
                </>
              ) : (
                <span style={{ fontSize: '18px', color: '#ccc' }}>+</span>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: '24px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {CATEGORIES.map(cat => (
          <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: getCategoryColor(cat) }} />
            <span style={{ fontSize: '11px', color: '#888' }}>{cat}</span>
          </div>
        ))}
      </div>

      {editingGoal && editingPosition !== null && (
        <EditModal
          goal={editingGoal as Partial<Goal> & { position: number }}
          allGoals={goals}
          relatedTasks={editingRelatedTasks}
          onSave={data => handleSave(editingPosition, data)}
          onClose={() => setEditingPosition(null)}
        />
      )}
    </div>
  )
}
