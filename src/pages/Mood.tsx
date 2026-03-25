import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase, getToday, formatDateTW } from '../lib/supabase'
import type { Journal, Mood as MoodType, MoodTag } from '../types'
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

const ENERGY_COLORS = ['', '#ef4444', '#f97316', '#eab308', '#22c55e', '#6366f1']
const ENERGY_LABELS = ['', '很低', '偏低', '普通', '不錯', '超好']
const MOOD_TAGS: MoodTag[] = ['平靜', '興奮', '疲憊', '焦慮', '快樂']

const TAG_COLORS: Record<MoodTag, string> = {
  平靜: '#3b82f6',
  興奮: '#f59e0b',
  疲憊: '#6b7280',
  焦慮: '#ef4444',
  快樂: '#22c55e',
}

export default function JournalMood() {
  const [currentDate, setCurrentDate] = useState(formatDate(new Date()))

  const [content, setContent] = useState('')
  const [journal, setJournal] = useState<Journal | null>(null)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [mood, setMood] = useState<MoodType | null>(null)
  const [energy, setEnergy] = useState(0)
  const [moodTags, setMoodTags] = useState<MoodTag[]>([])
  const [moodNote, setMoodNote] = useState('')
  const moodSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [pastJournals, setPastJournals] = useState<Journal[]>([])

  const today = formatDate(new Date())

  useEffect(() => {
    fetchJournal()
    fetchMood()
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

  async function fetchMood() {
    const { data } = await supabase
      .from('mood')
      .select('*')
      .eq('date', currentDate)
      .maybeSingle()
    if (data) {
      setMood(data)
      setEnergy(data.energy)
      setMoodTags(data.tags ?? [])
      setMoodNote(data.note ?? '')
    } else {
      setMood(null)
      setEnergy(0)
      setMoodTags([])
      setMoodNote('')
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
        setPastJournals(prev => prev.map(j => (j.date === date ? data : j)))
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

  async function saveMood(newEnergy: number, newTags: MoodTag[], newNote: string) {
    if (moodSaveRef.current) clearTimeout(moodSaveRef.current)
    moodSaveRef.current = setTimeout(async () => {
      if (newEnergy === 0) return
      if (mood) {
        const { data } = await supabase
          .from('mood')
          .update({ energy: newEnergy, tags: newTags, note: newNote })
          .eq('date', currentDate)
          .select()
          .single()
        if (data) setMood(data)
      } else {
        const { data } = await supabase
          .from('mood')
          .insert({ date: currentDate, energy: newEnergy, tags: newTags, note: newNote })
          .select()
          .single()
        if (data) setMood(data)
      }
    }, 600)
  }

  function handleEnergyChange(val: number) {
    setEnergy(val)
    saveMood(val, moodTags, moodNote)
  }

  function toggleMoodTag(tag: MoodTag) {
    const newTags = moodTags.includes(tag) ? moodTags.filter(t => t !== tag) : [...moodTags, tag]
    setMoodTags(newTags)
    saveMood(energy || 3, newTags, moodNote)
  }

  function handleMoodNoteChange(text: string) {
    setMoodNote(text)
    saveMood(energy || 3, moodTags, text)
  }

  const charCount = content.length

  return (
    <div style={{ padding: '0', maxWidth: '480px', margin: '0 auto', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '24px 16px 16px',
          borderBottom: '1px solid #ebebeb',
        }}
      >
        <button
          onClick={() => setCurrentDate(formatDate(addDays(new Date(currentDate), -1)))}
          style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: '4px' }}
        >
          <ChevronLeft size={20} />
        </button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '15px', fontWeight: '600', color: '#1a1a1a' }}>
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
                color: '#999',
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
            color: currentDate >= today ? '#ddd' : '#888',
            cursor: currentDate >= today ? 'not-allowed' : 'pointer',
            padding: '4px',
          }}
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Journal section */}
      <div style={{ padding: '16px' }}>
        <p style={{ fontSize: '12px', color: '#999', margin: '0 0 10px', fontWeight: '500' }}>
          日記
        </p>
        <textarea
          value={content}
          onChange={e => handleContentChange(e.target.value)}
          placeholder={currentDate === today
            ? '今天有什麼想記錄的？\n\n可以寫下任何事情——發生了什麼、感受如何、想到什麼...'
            : '這天的日記...'}
          style={{
            width: '100%',
            minHeight: '200px',
            padding: '16px',
            backgroundColor: '#f7f7f8',
            border: '1px solid #ebebeb',
            borderRadius: '16px',
            color: '#333',
            fontSize: '15px',
            lineHeight: '1.7',
            outline: 'none',
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
          <span style={{ fontSize: '11px', color: '#bbb' }}>{charCount} 字</span>
        </div>
      </div>

      {/* Mood section */}
      <div style={{ padding: '0 16px 16px' }}>
        <div
          style={{
            backgroundColor: '#f7f7f8',
            borderRadius: '16px',
            padding: '20px',
            border: '1px solid #ebebeb',
          }}
        >
          <p style={{ fontSize: '12px', color: '#999', margin: '0 0 16px', fontWeight: '500' }}>
            今日心情
          </p>

          {/* Energy score 1-5 */}
          <div style={{ marginBottom: '20px' }}>
            <p style={{ fontSize: '11px', color: '#999', margin: '0 0 10px' }}>能量分數</p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              {[1, 2, 3, 4, 5].map(val => (
                <button
                  key={val}
                  onClick={() => handleEnergyChange(val)}
                  style={{
                    width: '52px',
                    height: '52px',
                    borderRadius: '14px',
                    border: `2px solid ${energy === val ? ENERGY_COLORS[val] : '#e5e5e5'}`,
                    backgroundColor: energy === val ? ENERGY_COLORS[val] + '15' : '#ffffff',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '2px',
                    transition: 'all 0.15s',
                  }}
                >
                  <span
                    style={{
                      fontSize: '18px',
                      fontWeight: '700',
                      color: energy === val ? ENERGY_COLORS[val] : '#bbb',
                    }}
                  >
                    {val}
                  </span>
                  <span
                    style={{
                      fontSize: '8px',
                      color: energy === val ? ENERGY_COLORS[val] + 'cc' : '#bbb',
                    }}
                  >
                    {ENERGY_LABELS[val]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Mood tags */}
          <div style={{ marginBottom: '16px' }}>
            <p style={{ fontSize: '11px', color: '#999', margin: '0 0 10px' }}>心情標籤</p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {MOOD_TAGS.map(tag => {
                const selected = moodTags.includes(tag)
                const color = TAG_COLORS[tag]
                return (
                  <button
                    key={tag}
                    onClick={() => toggleMoodTag(tag)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '20px',
                      border: `1.5px solid ${selected ? color : '#e5e5e5'}`,
                      backgroundColor: selected ? color + '15' : '#ffffff',
                      color: selected ? color : '#999',
                      fontSize: '13px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {tag}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Mood note */}
          <input
            value={moodNote}
            onChange={e => handleMoodNoteChange(e.target.value)}
            placeholder="簡短備註（選填）"
            style={{
              width: '100%',
              padding: '10px 12px',
              backgroundColor: '#ffffff',
              border: '1px solid #ebebeb',
              borderRadius: '10px',
              color: '#333',
              fontSize: '13px',
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Past journals */}
      {pastJournals.length > 0 && (
        <div style={{ padding: '0 16px 16px' }}>
          <p style={{ fontSize: '12px', color: '#999', margin: '0 0 10px' }}>過往記錄</p>
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
                    backgroundColor: '#f7f7f8',
                    borderRadius: '10px',
                    border: '1px solid #ebebeb',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: '12px', color: '#999', flexShrink: 0 }}>{j.date}</span>
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
