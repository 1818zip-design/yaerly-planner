# Planner 2026

## 專案概述
個人生活管理工具，包含網頁前端 + Telegram Bot AI 助理。

## 技術架構
- **前端**: React + TypeScript + Vite，部署在 Vercel
- **後端**: Supabase (PostgreSQL + REST API)
- **Bot**: Vercel Serverless Functions (`api/`)，用 Claude Sonnet 4 處理自然語言
- **行事曆**: Google Calendar API (OAuth2 refresh token)
- **樣式**: 全 inline style，iOS 原生風格，無 CSS framework

## 配色系統
- 主色 `#8B9EC7` (霧藍紫) — 按鈕、導覽、進度條
- 輔色 `#C4A5A5` (煙霧玫瑰) — 心情、日記
- 點綴色 `#5C7A6B` (深苔綠) — 習慣完成、成功狀態
- 文字 `#1C1C1E` / `#6C6C70` / `#AEAEB2`
- 背景 `#F2F2F7`，卡片 `#FFFFFF` + `box-shadow: 0 1px 3px rgba(0,0,0,0.08)`

## 重要指令
- `npm run build` — TypeScript 檢查 + Vite 打包
- `npm run test:bot` — Bot 整合測試（11 個測試，模擬用戶操作 + 驗證 Supabase）
- `npx tsx api/telegram-webhook.ts "訊息"` — 本地測試單一 Bot 訊息
- `npx tsx api/daily-reminder.ts` — 本地測試每日提醒
- `npx tsx api/monthly-summary.ts` — 本地測試月度總結

## Vercel 部署
- 專案: `yaerly-planner`
- 網址: `https://yaerly-planner.vercel.app`
- push 到 main 自動部署
- 注意: 有第二個專案 `yaerly-planner-jwo8`，不要搞混

## 環境變數
- 前端用 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
- Serverless function 用 `SUPABASE_URL` / `SUPABASE_ANON_KEY`（無 VITE_ 前綴）
- Vercel 和 `.env` 都要設定

## Supabase 資料表
- `tasks` — 待辦任務（有自動順延邏輯）
- `expenses` — 記帳
- `habit_definitions` + `habit_logs` — 習慣追蹤
- `journal` — 日記
- `mood` — 心情記錄
- `goals` — 年度目標
- `bot_memory` — Telegram Bot 對話記憶

## Telegram Bot 功能
- 自然語言分流：任務/行程/記帳/習慣/日記/心情/目標/刪除/順延/完成
- 刷卡簡訊自動記帳（永豐銀行格式）
- Apple Pay 通知自動記帳
- 對話記憶存在 `bot_memory` 表

## Cron Jobs
- `daily-reminder`: 每天 UTC 14:00 (台北 22:00) — 自動順延未完成任務 + 提醒
- `monthly-summary`: 每月最後一天 UTC 16:00 (台北 00:00) — 月度總結

## 用戶偏好
- 回覆簡潔，最多 2 句，不說廢話
- 不問確認，直接做完告訴結果
- 繁體中文
- push 前一定要 `npm run build` 確認沒錯誤
- commit message 用英文
