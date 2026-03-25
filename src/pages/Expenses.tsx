import { useEffect, useState } from 'react'
import { supabase, getToday } from '../lib/supabase'
import type { Expense, ExpenseCategory } from '../types'
import { Trash2, Plus } from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'

const TODAY = getToday()

const CATEGORIES: ExpenseCategory[] = [
  '餐飲', '交通', '治裝購物', '學習', '朋友社交', '約會', '日常採買', '其他',
]

const CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  餐飲: '#f59e0b',
  交通: '#3b82f6',
  治裝購物: '#ec4899',
  學習: '#8b5cf6',
  朋友社交: '#22c55e',
  約會: '#ef4444',
  日常採買: '#06b6d4',
  其他: '#6b7280',
}

function getCurrentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Expenses() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [monthExpenses, setMonthExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<ExpenseCategory>('餐飲')
  const [note, setNote] = useState('')

  const currentMonth = getCurrentMonth()

  useEffect(() => {
    fetchAll()
  }, [])

  async function fetchAll() {
    setLoading(true)
    const [todayRes, monthRes] = await Promise.all([
      supabase.from('expenses').select('*').eq('date', TODAY).order('created_at', { ascending: false }),
      supabase.from('expenses').select('*').like('date', `${currentMonth}-%`).order('date', { ascending: false }),
    ])
    if (todayRes.data) setExpenses(todayRes.data)
    if (monthRes.data) setMonthExpenses(monthRes.data)
    setLoading(false)
  }

  async function addExpense() {
    if (!title.trim() || !amount.trim()) return
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) return

    const { data } = await supabase
      .from('expenses')
      .insert({ date: TODAY, title: title.trim(), amount: amt, category, note: note.trim() })
      .select()
      .single()
    if (data) {
      setExpenses(prev => [data, ...prev])
      setMonthExpenses(prev => [data, ...prev])
    }
    setTitle('')
    setAmount('')
    setNote('')
    setCategory('餐飲')
    setShowForm(false)
  }

  async function deleteExpense(id: string) {
    await supabase.from('expenses').delete().eq('id', id)
    setExpenses(prev => prev.filter(e => e.id !== id))
    setMonthExpenses(prev => prev.filter(e => e.id !== id))
  }

  const todayTotal = expenses.reduce((s, e) => s + e.amount, 0)
  const monthTotal = monthExpenses.reduce((s, e) => s + e.amount, 0)

  const categoryData = CATEGORIES.map(cat => ({
    name: cat,
    amount: monthExpenses.filter(e => e.category === cat).reduce((s, e) => s + e.amount, 0),
  })).filter(d => d.amount > 0)

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80dvh', color: '#999' }}>
        載入中...
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 16px', maxWidth: '480px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#1a1a1a', margin: 0 }}>記帳</h1>
        <button
          onClick={() => setShowForm(v => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 14px',
            borderRadius: '20px',
            border: 'none',
            backgroundColor: showForm ? '#e5e5e5' : '#7c3aed',
            color: showForm ? '#666' : '#fff',
            fontSize: '13px',
            fontWeight: '600',
            cursor: 'pointer',
          }}
        >
          <Plus size={15} />
          新增
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div
          style={{
            backgroundColor: '#f7f7f8',
            borderRadius: '16px',
            padding: '20px',
            border: '1px solid #ebebeb',
            marginBottom: '20px',
          }}
        >
          <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="名稱..."
              style={{
                flex: 2,
                padding: '10px 12px',
                backgroundColor: '#ffffff',
                border: '1px solid #e5e5e5',
                borderRadius: '10px',
                color: '#1a1a1a',
                fontSize: '14px',
                outline: 'none',
              }}
            />
            <input
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="金額"
              type="number"
              min="0"
              style={{
                flex: 1,
                padding: '10px 12px',
                backgroundColor: '#ffffff',
                border: '1px solid #e5e5e5',
                borderRadius: '10px',
                color: '#1a1a1a',
                fontSize: '14px',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                style={{
                  padding: '5px 10px',
                  borderRadius: '20px',
                  border: `1px solid ${category === cat ? CATEGORY_COLORS[cat] : '#e5e5e5'}`,
                  backgroundColor: category === cat ? CATEGORY_COLORS[cat] + '15' : 'transparent',
                  color: category === cat ? CATEGORY_COLORS[cat] : '#888',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="備註（選填）"
            style={{
              width: '100%',
              padding: '10px 12px',
              backgroundColor: '#ffffff',
              border: '1px solid #e5e5e5',
              borderRadius: '10px',
              color: '#1a1a1a',
              fontSize: '13px',
              outline: 'none',
              marginBottom: '12px',
            }}
          />

          <button
            onClick={addExpense}
            disabled={!title.trim() || !amount.trim()}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '10px',
              border: 'none',
              backgroundColor: title.trim() && amount.trim() ? '#7c3aed' : '#e5e5e5',
              color: title.trim() && amount.trim() ? '#fff' : '#999',
              fontSize: '14px',
              fontWeight: '600',
              cursor: title.trim() && amount.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            新增消費
          </button>
        </div>
      )}

      {/* Today summary */}
      <div
        style={{
          backgroundColor: '#f7f7f8',
          borderRadius: '16px',
          padding: '20px',
          border: '1px solid #ebebeb',
          marginBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <span style={{ fontSize: '13px', color: '#888' }}>今日支出</span>
          <span style={{ fontSize: '22px', fontWeight: '700', color: '#d97706' }}>
            ${todayTotal.toLocaleString()}
          </span>
        </div>
        {expenses.length === 0 ? (
          <p style={{ color: '#bbb', fontSize: '13px', margin: 0 }}>尚無記錄</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {expenses.map(e => (
              <div
                key={e.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 0',
                  borderBottom: '1px solid #ebebeb',
                }}
              >
                <div
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: CATEGORY_COLORS[e.category],
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: '14px', color: '#333' }}>{e.title}</span>
                  {e.note && (
                    <span style={{ fontSize: '11px', color: '#999', marginLeft: '8px' }}>
                      {e.note}
                    </span>
                  )}
                </div>
                <span
                  style={{
                    fontSize: '12px',
                    color: '#666',
                    backgroundColor: '#f0f0f0',
                    padding: '2px 7px',
                    borderRadius: '6px',
                    flexShrink: 0,
                  }}
                >
                  {e.category}
                </span>
                <span style={{ fontSize: '14px', fontWeight: '600', color: '#d97706', flexShrink: 0 }}>
                  ${e.amount.toLocaleString()}
                </span>
                <button
                  onClick={() => deleteExpense(e.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#ccc',
                    cursor: 'pointer',
                    padding: '2px',
                    flexShrink: 0,
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Monthly chart */}
      {categoryData.length > 0 && (
        <div
          style={{
            backgroundColor: '#f7f7f8',
            borderRadius: '16px',
            padding: '20px',
            border: '1px solid #ebebeb',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <span style={{ fontSize: '13px', color: '#888' }}>本月總計</span>
            <span style={{ fontSize: '18px', fontWeight: '700', color: '#d97706' }}>
              ${monthTotal.toLocaleString()}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={categoryData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis
                dataKey="name"
                tick={{ fill: '#888', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#888', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #e5e5e5',
                  borderRadius: '8px',
                  color: '#1a1a1a',
                  fontSize: '13px',
                }}
                formatter={(value: number) => [`$${value.toLocaleString()}`, '金額']}
              />
              <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                {categoryData.map((entry) => (
                  <Cell key={entry.name} fill={CATEGORY_COLORS[entry.name as ExpenseCategory]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
