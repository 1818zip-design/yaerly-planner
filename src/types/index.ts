export interface Goal {
  id: string
  title: string
  position: number // 1-20
  completed: boolean
  completed_at: string | null
  category: string
  connections: string[] // uuid[]
  created_at: string
}

export type TimeSlot = 'morning' | 'afternoon' | 'evening' | 'anytime'

export interface Task {
  id: string
  title: string
  date: string // YYYY-MM-DD
  time_slot: TimeSlot
  completed: boolean
  goal_id: string | null
  tags: string[]
  carried_over: boolean
  original_date: string | null
  created_at: string
}

export interface Habit {
  id: string
  date: string // YYYY-MM-DD, unique
  exercise: boolean
  korean: boolean
  movie: boolean
  english: boolean
  notes: Record<string, string> // jsonb
  created_at: string
}

export interface HabitDefinition {
  id: string
  name: string
  created_at: string
}

export interface HabitLog {
  id: string
  date: string // YYYY-MM-DD
  habit_id: string
  completed: boolean
  note: string
  created_at: string
}

export type ExpenseCategory =
  | '餐飲'
  | '交通'
  | '治裝購物'
  | '學習'
  | '朋友社交'
  | '約會'
  | '日常採買'
  | '其他'

export interface Expense {
  id: string
  date: string // YYYY-MM-DD
  title: string
  amount: number
  category: ExpenseCategory
  note: string
  created_at: string
}

export type MoodTag = '平靜' | '興奮' | '疲憊' | '焦慮' | '快樂'

export interface Mood {
  id: string
  date: string // YYYY-MM-DD, unique
  energy: number // 1-5
  tags: MoodTag[]
  note: string
  created_at: string
}

export interface Journal {
  id: string
  date: string // YYYY-MM-DD, unique
  content: string
  updated_at: string
  created_at: string
}
