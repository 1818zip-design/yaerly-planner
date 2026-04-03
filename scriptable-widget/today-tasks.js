// ============================================
// 📋 Planner 2026 — Today Tasks Widget
// Scriptable iPhone Widget (Medium)
// ============================================

// ⬇️ 填入你的 Supabase 設定
const SUPABASE_URL = ''
const SUPABASE_ANON_KEY = ''

// ============================================

const COLORS = {
  bg: new Color('#FFFFFF'),
  primary: new Color('#8B9EC7'),
  green: new Color('#5C7A6B'),
  accent: new Color('#C4A5A5'),
  text: new Color('#1C1C1E'),
  secondary: new Color('#6C6C70'),
  tertiary: new Color('#AEAEB2'),
  separator: new Color('#F2F2F7'),
}

const DAYS_ZH = ['日', '一', '二', '三', '四', '五', '六']
const MAX_TASKS = 5

function getToday() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function formatDateZh(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()} 週${DAYS_ZH[d.getDay()]}`
}

function timeSlotLabel(slot) {
  switch (slot) {
    case 'morning': return '上午'
    case 'afternoon': return '下午'
    case 'evening': return '晚上'
    default: return ''
  }
}

async function fetchTasks(date) {
  const url = `${SUPABASE_URL}/rest/v1/tasks?date=eq.${date}&order=created_at`
  const req = new Request(url)
  req.headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  }
  try {
    return await req.loadJSON()
  } catch {
    return []
  }
}

async function createWidget() {
  const today = getToday()
  const tasks = await fetchTasks(today)
  const done = tasks.filter(t => t.completed).length
  const total = tasks.length

  const w = new ListWidget()
  w.backgroundColor = COLORS.bg
  w.url = 'https://yaerly-planner.vercel.app/tasks'
  w.setPadding(14, 16, 14, 16)

  // --- Header: date + progress ---
  const header = w.addStack()
  header.layoutHorizontally()
  header.centerAlignContent()

  const dateText = header.addText(formatDateZh(today))
  dateText.font = Font.semiboldSystemFont(15)
  dateText.textColor = COLORS.text

  header.addSpacer()

  const progress = header.addText(`${done}/${total}`)
  progress.font = Font.boldMonospacedSystemFont(14)
  progress.textColor = done === total && total > 0 ? COLORS.green : COLORS.primary

  w.addSpacer(4)

  // --- Progress bar ---
  const barStack = w.addStack()
  barStack.layoutHorizontally()
  barStack.size = new Size(0, 4)
  barStack.cornerRadius = 2

  const pct = total > 0 ? done / total : 0
  const barWidth = 280

  if (pct > 0) {
    const filled = barStack.addImage(createBar(Math.round(barWidth * pct), 4, COLORS.primary))
    filled.imageSize = new Size(Math.round(barWidth * pct), 4)
  }
  if (pct < 1) {
    const empty = barStack.addImage(createBar(Math.round(barWidth * (1 - pct)), 4, COLORS.separator))
    empty.imageSize = new Size(Math.round(barWidth * (1 - pct)), 4)
  }

  w.addSpacer(8)

  // --- Task list ---
  if (total === 0) {
    const empty = w.addText('今天沒有任務 🎉')
    empty.font = Font.regularSystemFont(13)
    empty.textColor = COLORS.tertiary
  } else {
    const shown = tasks.slice(0, MAX_TASKS)
    for (const task of shown) {
      const row = w.addStack()
      row.layoutHorizontally()
      row.centerAlignContent()
      row.spacing = 8

      // Dot
      const dot = row.addText(task.completed ? '●' : '○')
      dot.font = Font.systemFont(10)
      dot.textColor = task.completed ? COLORS.green : COLORS.primary

      // Time slot
      const slot = timeSlotLabel(task.time_slot)
      if (slot) {
        const slotText = row.addText(slot)
        slotText.font = Font.mediumSystemFont(10)
        slotText.textColor = COLORS.accent
      }

      // Title
      const title = row.addText(task.title)
      title.font = Font.regularSystemFont(13)
      title.textColor = task.completed ? COLORS.tertiary : COLORS.text
      title.lineLimit = 1
      if (task.completed) {
        title.textOpacity = 0.6
      }

      row.addSpacer()

      // Carried over badge
      if (task.carried_over) {
        const badge = row.addText('↻')
        badge.font = Font.systemFont(10)
        badge.textColor = COLORS.accent
      }

      w.addSpacer(2)
    }

    // "還有 N 項"
    if (total > MAX_TASKS) {
      w.addSpacer(2)
      const more = w.addText(`還有 ${total - MAX_TASKS} 項`)
      more.font = Font.regularSystemFont(11)
      more.textColor = COLORS.tertiary
    }
  }

  w.addSpacer()
  return w
}

function createBar(width, height, color) {
  const ctx = new DrawContext()
  ctx.size = new Size(width, height)
  ctx.opaque = false
  ctx.setFillColor(color)
  ctx.fillRect(new Rect(0, 0, width, height))
  return ctx.getImage()
}

// --- Run ---
const widget = await createWidget()

if (config.runsInWidget) {
  Script.setWidget(widget)
} else {
  await widget.presentMedium()
}

Script.complete()
