import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase, formatDateTW } from '../lib/supabase'
import type { Journal as JournalType } from '../types'
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react'

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
  const days = ['日', '一', '二', '三', '四', '五', '六']
  if (dateStr === today) return `今天 · ${d.getMonth() + 1}/${d.getDate()} (週${days[d.getDay()]})`
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} (週${days[d.getDay()]})`
}

function formatTime(isoStr: string) {
  const d = new Date(isoStr)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

export default function Journal() {
  const [currentDate, setCurrentDate] = useState(formatDate(new Date()))
  const [content, setContent] = useState('')
  const [journal, setJournal] = useState<JournalType | null>(null)
  const [pastJournals, setPastJournals] = useState<JournalType[]>([])
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetchJournal()
  }, [currentDate])

  useEffect(() => {
    fetchPastJournals()
  }, [])

  async function fetchJournal() {
    const { data } = await supabase
      .from('journal')
      .select('*')
      .eq('date', currentDate)
      .maybeSingle()
    if (data) {
      setJournal(data)
      setContent(data.content)
      setLastSaved(data.updated_at)
    } else {
      setJournal(null)
      setContent('')
      setLastSaved(null)
    }
  }

  async function fetchPastJournals() {
    const { data } = await supabase
      .from('journal')
      .select('*')
      .order('date', { ascending: false })
      .limit(30)
    if (data) setPastJournals(data)
  }

  const saveJournal = useCallback(async (text: string, date: string) => {
    setSaving(true)
    const now = new Date().toISOString()
    if (journal) {
      const { data } = await supabase
        .from('journal')
        .update({ content: text, updated_at: now })
        .eq('date', date)
        .select()
        .single()
      if (data) {
        setJournal(data)
        setLastSaved(data.updated_at)
        setPastJournals(prev =>
          prev.map(j => (j.date === date ? data : j))
        )
      }
    } else {
      const { data } = await supabase
        .from('journal')
        .insert({ date, content: text, updated_at: now })
        .select()
        .single()
      if (data) {
        setJournal(data)
        setLastSaved(data.updated_at)
        setPastJournals(prev => [data, ...prev.filter(j => j.date !== date)])
      }
    }
    setSaving(false)
  }, [journal])

  function handleContentChange(text: string) {
    setContent(text)
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      saveJournal(text, currentDate)
    }, 1200)
  }

  const today = formatDate(new Date())
  const charCount = content.length

  return (
    <div style={{ padding: '0', maxWidth: '480px', margin: '0 auto', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '24px 16px 16px',
          borderBottom: '1px solid #1a1a1a',
        }}
      >
        <button
          onClick={() => setCurrentDate(formatDate(addDays(new Date(currentDate), -1)))}
          style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '4px' }}
        >
          <ChevronLeft size={20} />
        </button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '15px', fontWeight: '600', color: '#f0f0f0' }}>
            {displayDate(currentDate)}
          </div>
          {lastSaved && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                fontSize: '11px',
                color: '#444',
                marginTop: '2px',
              }}
            >
              <Clock size={10} />
              {saving ? '儲存中...' : `已儲存 ${formatTime(lastSaved)}`}
            </div>
          )}
        </div>
        <button
          onClick={() => setCurrentDate(formatDate(addDays(new Date(currentDate), 1)))}
          disabled={currentDate >= today}
          style={{
            background: 'none',
            border: 'none',
            color: currentDate >= today ? '#2a2a2a' : '#666',
            cursor: currentDate >= today ? 'not-allowed' : 'pointer',
            padding: '4px',
          }}
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Writing area */}
      <div style={{ flex: 1, padding: '16px', display: 'flex', flexDirection: 'column' }}>
        <textarea
          value={content}
          onChange={e => handleContentChange(e.target.value)}
          placeholder={currentDate === today
            ? '今天有什麼想記錄的？\n\n可以寫下任何事情——發生了什麼、感受如何、想到什麼...'
            : '這天的日記...'}
          style={{
            flex: 1,
            width: '100%',
            minHeight: '320px',
            padding: '16px',
            backgroundColor: '#111',
            border: '1px solid #1e1e1e',
            borderRadius: '16px',
            color: '#ddd',
            fontSize: '15px',
            lineHeight: '1.7',
            outline: 'none',
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
          <span style={{ fontSize: '11px', color: '#333' }}>{charCount} 字</span>
        </div>
      </div>

      {/* Past journals */}
      {pastJournals.length > 0 && (
        <div style={{ padding: '0 16px 16px' }}>
          <p style={{ fontSize: '12px', color: '#444', marginBottom: '10px', margin: '0 0 10px' }}>
            過往記錄
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {pastJournals
              .filter(j => j.date !== currentDate)
              .slice(0, 5)
              .map(j => (
                <button
                  key={j.id}
                  onClick={() => setCurrentDate(j.date)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 14px',
                    backgroundColor: '#111',
                    borderRadius: '10px',
                    border: '1px solid #1a1a1a',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: '12px', color: '#555', flexShrink: 0 }}>{j.date}</span>
                  <span
                    style={{
                      fontSize: '13px',
                      color: '#666',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                    }}
                  >
                    {j.content.slice(0, 60) || '（空白）'}
                  </span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
