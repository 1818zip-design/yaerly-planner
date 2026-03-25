import { useEffect, useState } from 'react'
import { supabase, getToday } from '../lib/supabase'
import type { Expense, ExpenseCategory } from '../types'
import { Trash2, Plus, X, ChevronLeft, ChevronRight, Pencil } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie,
} from 'recharts'

const CATEGORIES: ExpenseCategory[] = [
  '餐飲', '交通', '治裝購物', '學習', '朋友社交', '約會', '日常採買', '其他',
]

const CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  餐飲: '#f59e0b', 交通: '#3b82f6', 治裝購物: '#ec4899', 學習: '#8b5cf6',
  朋友社交: '#22c55e', 約會: '#ef4444', 日常採買: '#06b6d4', 其他: '#6b7280',
}

type Tab = 'overview' | 'category' | 'list'

function getMonthRange(d: Date) {
  const y = d.getFullYear()
  const m = d.getMonth()
  const lastDay = new Date(y, m + 1, 0).getDate()
  const mm = String(m + 1).padStart(2, '0')
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${lastDay}`, year: y, month: m, lastDay }
}

export default function Expenses() {
  const today = getToday()
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }))
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('overview')
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<ExpenseCategory | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Form state
  const [fTitle, setFTitle] = useState('')
  const [fAmount, setFAmount] = useState('')
  const [fCategory, setFCategory] = useState<ExpenseCategory>('餐飲')
  const [fDate, setFDate] = useState(today)
  const [fNote, setFNote] = useState('')

  const { start, end, year, month, lastDay } = getMonthRange(currentMonth)

  useEffect(() => {
    fetchMonth()
    setSelectedDay(null)
    setSelectedCategory(null)
  }, [currentMonth])

  async function fetchMonth() {
    setLoading(true)
    const { data } = await supabase
      .from('expenses').select('*')
      .gte('date', start).lte('date', end)
      .order('date', { ascending: false })
    if (data) setExpenses(data)
    setLoading(false)
  }

  function openAdd() {
    setEditingId(null)
    setFTitle('')
    setFAmount('')
    setFCategory('餐飲')
    setFDate(today)
    setFNote('')
    setShowForm(true)
  }

  function openEdit(e: Expense) {
    setEditingId(e.id)
    setFTitle(e.title)
    setFAmount(String(e.amount))
    setFCategory(e.category)
    setFDate(e.date)
    setFNote(e.note)
    setShowForm(true)
  }

  async function saveExpense() {
    if (!fTitle.trim() || !fAmount.trim()) return
    const amt = parseFloat(fAmount)
    if (isNaN(amt) || amt <= 0) return

    if (editingId) {
      const { data } = await supabase
        .from('expenses')
        .update({ title: fTitle.trim(), amount: amt, category: fCategory, date: fDate, note: fNote.trim() })
        .eq('id', editingId).select().single()
      if (data) setExpenses(prev => prev.map(e => e.id === data.id ? data : e))
    } else {
      const { data } = await supabase
        .from('expenses')
        .insert({ date: fDate, title: fTitle.trim(), amount: amt, category: fCategory, note: fNote.trim() })
        .select().single()
      if (data) setExpenses(prev => [data, ...prev])
    }
    setShowForm(false)
  }

  async function deleteExpense(id: string) {
    await supabase.from('expenses').delete().eq('id', id)
    setExpenses(prev => prev.filter(e => e.id !== id))
  }

  // --- Computed data ---
  const monthTotal = expenses.reduce((s, e) => s + e.amount, 0)
  const daysElapsed = Math.min(
    parseInt(today.slice(8, 10)),
    lastDay
  )
  const dailyAvg = daysElapsed > 0 ? Math.round(monthTotal / daysElapsed) : 0
  const maxExpense = expenses.length > 0 ? expenses.reduce((m, e) => e.amount > m.amount ? e : m, expenses[0]) : null
  const topCategory = (() => {
    const sums: Record<string, number> = {}
    expenses.forEach(e => { sums[e.category] = (sums[e.category] || 0) + e.amount })
    const sorted = Object.entries(sums).sort((a, b) => b[1] - a[1])
    return sorted[0] ? sorted[0][0] : '-'
  })()

  // Pie chart data
  const pieData = CATEGORIES.map(cat => ({
    name: cat,
    value: expenses.filter(e => e.category === cat).reduce((s, e) => s + e.amount, 0),
  })).filter(d => d.value > 0)

  // Daily bar chart data
  const dailyData: { day: string; amount: number }[] = []
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const dayTotal = expenses.filter(e => e.date === dateStr).reduce((s, e) => s + e.amount, 0)
    dailyData.push({ day: String(d), amount: dayTotal })
  }

  // Category breakdown
  const categoryBreakdown = CATEGORIES.map(cat => ({
    name: cat,
    amount: expenses.filter(e => e.category === cat).reduce((s, e) => s + e.amount, 0),
    count: expenses.filter(e => e.category === cat).length,
    pct: monthTotal > 0 ? Math.round(expenses.filter(e => e.category === cat).reduce((s, e) => s + e.amount, 0) / monthTotal * 100) : 0,
  })).sort((a, b) => b.amount - a.amount)

  // Selected day expenses
  const dayExpenses = selectedDay ? expenses.filter(e => e.date === selectedDay).sort((a, b) => a.created_at > b.created_at ? -1 : 1) : []

  // Selected category expenses
  const catExpenses = selectedCategory ? expenses.filter(e => e.category === selectedCategory).sort((a, b) => a.date > b.date ? -1 : 1) : []

  const card = { backgroundColor: '#f7f7f8', borderRadius: '16px', padding: '16px', border: '1px solid #ebebeb' }

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80dvh', color: '#999' }}>載入中...</div>
  }

  return (
    <div style={{ padding: '24px 16px 16px', maxWidth: '480px', margin: '0 auto' }}>
      {/* Month navigation */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <button onClick={() => setCurrentMonth(new Date(year, month - 1, 1))} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: '4px' }}>
          <ChevronLeft size={20} />
        </button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: '700', color: '#1a1a1a' }}>{year} 年 {month + 1} 月</div>
          <div style={{ fontSize: '24px', fontWeight: '700', color: '#d97706', marginTop: '4px' }}>${monthTotal.toLocaleString()}</div>
        </div>
        <button onClick={() => setCurrentMonth(new Date(year, month + 1, 1))} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: '4px' }}>
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '16px' }}>
        <div style={{ ...card, padding: '12px', textAlign: 'center' }}>
          <div style={{ fontSize: '10px', color: '#999' }}>日均</div>
          <div style={{ fontSize: '15px', fontWeight: '700', color: '#333' }}>${dailyAvg.toLocaleString()}</div>
        </div>
        <div style={{ ...card, padding: '12px', textAlign: 'center' }}>
          <div style={{ fontSize: '10px', color: '#999' }}>最大單筆</div>
          <div style={{ fontSize: '15px', fontWeight: '700', color: '#333' }}>${maxExpense ? maxExpense.amount.toLocaleString() : '0'}</div>
        </div>
        <div style={{ ...card, padding: '12px', textAlign: 'center' }}>
          <div style={{ fontSize: '10px', color: '#999' }}>最常分類</div>
          <div style={{ fontSize: '15px', fontWeight: '700', color: CATEGORY_COLORS[topCategory as ExpenseCategory] || '#333' }}>{topCategory}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0', marginBottom: '16px', borderRadius: '10px', overflow: 'hidden', border: '1px solid #e5e5e5' }}>
        {([['overview', '總覽'], ['category', '分類'], ['list', '明細']] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setTab(key); setSelectedDay(null); setSelectedCategory(null) }}
            style={{
              flex: 1, padding: '10px', border: 'none',
              backgroundColor: tab === key ? '#7c3aed' : '#fff',
              color: tab === key ? '#fff' : '#888',
              fontSize: '13px', fontWeight: '600', cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* === OVERVIEW TAB === */}
      {tab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Pie chart */}
          {pieData.length > 0 && (
            <div style={card}>
              <p style={{ fontSize: '12px', color: '#999', margin: '0 0 8px', fontWeight: '500' }}>分類佔比</p>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={40} paddingAngle={2}>
                    {pieData.map(d => <Cell key={d.name} fill={CATEGORY_COLORS[d.name as ExpenseCategory]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
                {pieData.map(d => (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#666' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: CATEGORY_COLORS[d.name as ExpenseCategory] }} />
                    {d.name}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Daily bar chart */}
          {expenses.length > 0 && (
            <div style={card}>
              <p style={{ fontSize: '12px', color: '#999', margin: '0 0 8px', fontWeight: '500' }}>每日花費</p>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={dailyData} margin={{ top: 0, right: 0, left: -25, bottom: 0 }}>
                  <XAxis dataKey="day" tick={{ fill: '#999', fontSize: 9 }} axisLine={false} tickLine={false} interval={4} />
                  <YAxis tick={{ fill: '#999', fontSize: 9 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, '金額']} />
                  <Bar
                    dataKey="amount" radius={[3, 3, 0, 0]} fill="#d97706"
                    onClick={(_: unknown, idx: number) => {
                      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(idx + 1).padStart(2, '0')}`
                      setSelectedDay(selectedDay === dateStr ? null : dateStr)
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Selected day detail */}
          {selectedDay && dayExpenses.length > 0 && (
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <p style={{ fontSize: '12px', color: '#999', margin: 0, fontWeight: '500' }}>{selectedDay}</p>
                <span style={{ fontSize: '14px', fontWeight: '700', color: '#d97706' }}>
                  ${dayExpenses.reduce((s, e) => s + e.amount, 0).toLocaleString()}
                </span>
              </div>
              {dayExpenses.map(e => (
                <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #ebebeb' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: CATEGORY_COLORS[e.category] }} />
                    <span style={{ fontSize: '13px', color: '#333' }}>{e.title}</span>
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: '#d97706' }}>${e.amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* === CATEGORY TAB === */}
      {tab === 'category' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {selectedCategory === null ? (
            categoryBreakdown.map(cat => (
              <button
                key={cat.name}
                onClick={() => cat.count > 0 && setSelectedCategory(cat.name as ExpenseCategory)}
                style={{
                  ...card, display: 'flex', alignItems: 'center', gap: '12px',
                  cursor: cat.count > 0 ? 'pointer' : 'default', textAlign: 'left',
                }}
              >
                <div style={{
                  width: '36px', height: '36px', borderRadius: '10px',
                  backgroundColor: CATEGORY_COLORS[cat.name as ExpenseCategory] + '15',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: CATEGORY_COLORS[cat.name as ExpenseCategory], fontSize: '14px', fontWeight: '700',
                }}>
                  {cat.pct}%
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', color: '#333', fontWeight: '500' }}>{cat.name}</div>
                  <div style={{ fontSize: '11px', color: '#999' }}>{cat.count} 筆</div>
                </div>
                <div style={{ fontSize: '15px', fontWeight: '700', color: cat.amount > 0 ? '#333' : '#ccc' }}>
                  ${cat.amount.toLocaleString()}
                </div>
              </button>
            ))
          ) : (
            <>
              <button
                onClick={() => setSelectedCategory(null)}
                style={{ background: 'none', border: 'none', color: '#7c3aed', fontSize: '13px', cursor: 'pointer', textAlign: 'left', padding: '4px 0', marginBottom: '4px' }}
              >
                ← 返回分類
              </button>
              <div style={{ fontSize: '16px', fontWeight: '700', color: CATEGORY_COLORS[selectedCategory], marginBottom: '8px' }}>
                {selectedCategory} · ${catExpenses.reduce((s, e) => s + e.amount, 0).toLocaleString()}
              </div>
              {catExpenses.map(e => (
                <div key={e.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', color: '#333' }}>{e.title}</div>
                    <div style={{ fontSize: '11px', color: '#999' }}>{e.date}{e.note ? ` · ${e.note}` : ''}</div>
                  </div>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: '#d97706' }}>${e.amount.toLocaleString()}</span>
                  <button onClick={() => openEdit(e)} style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', padding: '2px' }}>
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => deleteExpense(e.id)} style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', padding: '2px' }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* === LIST TAB === */}
      {tab === 'list' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {expenses.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#ccc', padding: '40px 0', fontSize: '14px' }}>本月尚無記錄</div>
          ) : (
            expenses.map(e => (
              <div key={e.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px' }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: CATEGORY_COLORS[e.category], flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', color: '#333' }}>{e.title}</div>
                  <div style={{ fontSize: '11px', color: '#999' }}>
                    {e.date}
                    <span style={{
                      marginLeft: '6px', fontSize: '10px', color: CATEGORY_COLORS[e.category],
                      backgroundColor: CATEGORY_COLORS[e.category] + '15',
                      padding: '1px 6px', borderRadius: '6px',
                    }}>
                      {e.category}
                    </span>
                  </div>
                </div>
                <span style={{ fontSize: '14px', fontWeight: '600', color: '#d97706', flexShrink: 0 }}>
                  ${e.amount.toLocaleString()}
                </span>
                <button onClick={() => openEdit(e)} style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', padding: '2px', flexShrink: 0 }}>
                  <Pencil size={13} />
                </button>
                <button onClick={() => deleteExpense(e.id)} style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', padding: '2px', flexShrink: 0 }}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Floating add button */}
      {!showForm && (
        <button
          onClick={openAdd}
          style={{
            position: 'fixed', bottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
            right: '20px', width: '52px', height: '52px', borderRadius: '50%',
            backgroundColor: '#7c3aed', color: '#fff', border: 'none',
            boxShadow: '0 4px 16px rgba(124,58,237,0.3)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <Plus size={24} />
        </button>
      )}

      {/* Add/Edit modal */}
      {showForm && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={() => setShowForm(false)}
        >
          <div
            style={{
              backgroundColor: '#ffffff', borderRadius: '20px 20px 0 0',
              padding: '24px 20px', paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
              width: '100%', maxWidth: '480px',
              maxHeight: '85dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.1)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', color: '#1a1a1a' }}>
                {editingId ? '編輯消費' : '新增消費'}
              </h3>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', color: '#999', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            {/* Amount - big input */}
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <span style={{ fontSize: '14px', color: '#999' }}>$</span>
              <input
                autoFocus
                value={fAmount}
                onChange={e => setFAmount(e.target.value)}
                placeholder="0"
                type="number"
                min="0"
                style={{
                  fontSize: '36px', fontWeight: '700', color: '#d97706',
                  border: 'none', outline: 'none', textAlign: 'center',
                  width: '200px', backgroundColor: 'transparent',
                }}
              />
            </div>

            <input
              value={fTitle}
              onChange={e => setFTitle(e.target.value)}
              placeholder="名稱..."
              style={{
                width: '100%', padding: '12px', backgroundColor: '#f7f7f8',
                border: '1px solid #e5e5e5', borderRadius: '10px',
                color: '#1a1a1a', fontSize: '15px', outline: 'none', marginBottom: '12px',
              }}
            />

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => setFCategory(cat)}
                  style={{
                    padding: '6px 12px', borderRadius: '20px',
                    border: `1.5px solid ${fCategory === cat ? CATEGORY_COLORS[cat] : '#e5e5e5'}`,
                    backgroundColor: fCategory === cat ? CATEGORY_COLORS[cat] + '15' : 'transparent',
                    color: fCategory === cat ? CATEGORY_COLORS[cat] : '#888',
                    fontSize: '12px', fontWeight: '500', cursor: 'pointer',
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
              <input
                type="date"
                value={fDate}
                onChange={e => setFDate(e.target.value)}
                style={{
                  flex: 1, padding: '10px 12px', backgroundColor: '#f7f7f8',
                  border: '1px solid #e5e5e5', borderRadius: '10px',
                  color: '#1a1a1a', fontSize: '13px', outline: 'none',
                }}
              />
              <input
                value={fNote}
                onChange={e => setFNote(e.target.value)}
                placeholder="備註（選填）"
                style={{
                  flex: 1, padding: '10px 12px', backgroundColor: '#f7f7f8',
                  border: '1px solid #e5e5e5', borderRadius: '10px',
                  color: '#1a1a1a', fontSize: '13px', outline: 'none',
                }}
              />
            </div>

            <button
              onClick={saveExpense}
              disabled={!fTitle.trim() || !fAmount.trim()}
              style={{
                width: '100%', padding: '14px', borderRadius: '12px', border: 'none',
                backgroundColor: fTitle.trim() && fAmount.trim() ? '#7c3aed' : '#e5e5e5',
                color: fTitle.trim() && fAmount.trim() ? '#fff' : '#999',
                fontSize: '15px', fontWeight: '600',
                cursor: fTitle.trim() && fAmount.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              {editingId ? '儲存' : '新增'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
