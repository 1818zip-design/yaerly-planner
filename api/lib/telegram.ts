import { env } from './helpers.js'

export interface TelegramPhoto {
  file_id: string
  file_unique_id: string
  width: number
  height: number
  file_size?: number
}

export interface TelegramUpdate {
  message?: {
    chat: { id: number }
    text?: string
    photo?: TelegramPhoto[]
    caption?: string
  }
}

export async function sendTelegram(chatId: number, text: string): Promise<void> {
  const truncated = text.length > 4000 ? text.slice(0, 4000) + '...' : text
  await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: truncated, parse_mode: 'HTML' }),
  })
}

export async function downloadTelegramPhoto(fileId: string): Promise<string | null> {
  const token = env('TELEGRAM_BOT_TOKEN')
  const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`)
  if (!fileRes.ok) return null
  const fileData = await fileRes.json() as { result: { file_path: string } }
  const filePath = fileData.result.file_path

  const downloadRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`)
  if (!downloadRes.ok) return null
  const buffer = await downloadRes.arrayBuffer()
  return Buffer.from(buffer).toString('base64')
}
