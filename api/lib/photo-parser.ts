import Anthropic from '@anthropic-ai/sdk'
import { env, getTodayTaipei } from './helpers.js'
import { downloadTelegramPhoto, type TelegramPhoto } from './telegram.js'
import { pushHistory } from './memory.js'

export interface ParsedEvent {
  date: string
  time: string
  title: string
  location: string
}

async function parseCalendarScreenshot(base64Image: string): Promise<ParsedEvent[]> {
  const apiKey = env('ANTHROPIC_API_KEY')
  if (!apiKey) return []

  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Image } },
        {
          type: 'text',
          text: `這是一張行事曆截圖，請解析出所有行程資訊。
回傳 JSON 陣列，格式：
[{ "date": "YYYY-MM-DD", "time": "HH:MM", "title": "事項名稱", "location": "地點或空字串" }]

規則：
- 年份用 ${getTodayTaipei().slice(0, 4)} 年
- 時間用 24 小時制
- 只回傳 JSON，不要其他文字
- 如果看不出行程就回傳 []`,
        },
      ],
    }],
  })

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text).join('')

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []
    return JSON.parse(jsonMatch[0]) as ParsedEvent[]
  } catch {
    console.error('[parseCalendarScreenshot] JSON parse failed:', text)
    return []
  }
}

export async function handlePhotoMessage(chatId: number, photos: TelegramPhoto[]): Promise<string> {
  const photo = photos[photos.length - 1]
  const base64 = await downloadTelegramPhoto(photo.file_id)
  if (!base64) return '❌ 無法下載圖片'

  const events = await parseCalendarScreenshot(base64)
  if (events.length === 0) return '看不出行程資訊，請傳清楚一點的截圖'

  const lines = events.map(e => `• ${e.date} ${e.time} ${e.title}${e.location ? ` (${e.location})` : ''}`)
  const confirmMsg = [`我看到以下行程：`, ...lines, '', '要幫你全部加到 Google Calendar 嗎？'].join('\n')

  const eventsJson = JSON.stringify(events)
  await pushHistory(chatId, 'user', `[圖片] 行事曆截圖，解析出 ${events.length} 個行程`)
  await pushHistory(chatId, 'assistant', `${confirmMsg}\n\n[PENDING_EVENTS:${eventsJson}]`)

  return confirmMsg
}
