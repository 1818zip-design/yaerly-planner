import { supabaseUrl, supabaseHeaders } from './helpers.js'

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

const MAX_HISTORY = 5

export async function getHistory(chatId: number): Promise<ConversationMessage[]> {
  try {
    const res = await fetch(
      supabaseUrl(`bot_memory?chat_id=eq.${chatId}`),
      { headers: supabaseHeaders() },
    )
    if (!res.ok) return []
    const rows = await res.json() as { messages: ConversationMessage[] }[]
    return rows.length > 0 ? (rows[0].messages || []) : []
  } catch {
    return []
  }
}

export async function pushHistory(chatId: number, role: 'user' | 'assistant', content: string) {
  try {
    const history = await getHistory(chatId)
    history.push({ role, content })
    while (history.length > MAX_HISTORY * 2) history.shift()

    const body = { chat_id: chatId, messages: history, updated_at: new Date().toISOString() }
    const updateRes = await fetch(
      supabaseUrl(`bot_memory?chat_id=eq.${chatId}`),
      { method: 'PATCH', headers: supabaseHeaders(), body: JSON.stringify({ messages: history, updated_at: body.updated_at }) },
    )
    if (updateRes.ok) {
      const updated = await updateRes.json()
      if (Array.isArray(updated) && updated.length > 0) return
    }
    await fetch(supabaseUrl('bot_memory'), {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error('[pushHistory] Error:', err)
  }
}
