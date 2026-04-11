# Telegram Inline Keyboard Buttons Feature

## Overview
Added support for **Telegram inline keyboard buttons** to Linda's admin interface. This allows administrators to quickly execute commands by clicking buttons instead of typing.

## Implementation Details

### 1. **Bot Response Handler** (`src/bot.ts`)
When sending responses to admin users, Linda now includes inline keyboard buttons with the following commands:

```
[📋 Все сессии] [🔍 Деталь сессии]
[✉️ Отправить сообщение] [✏️ Отредактировать]
[🔄 Сбросить контекст] [🏢 Настройки фирмы]
```

- Buttons only appear on **admin messages** (not client)
- Buttons appear only on the **last message chunk** to avoid clutter
- Each button has:
  - Visual emoji + text label (in Russian)
  - callback_data with the command (e.g., `/sessions`)

### 2. **Telegram API Integration** (`src/telegram.ts`)

#### New Types
- `TelegramCallbackQuery` — Telegram's callback query structure when a button is clicked
- Updated `TelegramUpdate` — Now includes `callback_query` field

#### Callback Query Handling
```typescript
if (update.callback_query) {
  // Extract button press data and treat as normal message
  // E.g., button "Все сессии" sends callback_data: "/sessions"
  // Linda processes this as if admin typed "/sessions"
}
```

#### Updated `sendText()` Method
```typescript
async sendText(
  chatId: string, 
  text: string, 
  suggestions?: string[], 
  inlineButtons?: Array<{ text: string; callback_data: string }>[]
)
```

**Inline buttons take precedence over suggestions:**
1. If `inlineButtons` provided → use `inline_keyboard` with button grid
2. Else if `suggestions` provided → use regular `keyboard` (for client)
3. Else → `remove_keyboard`

#### API Updates
- `allowed_updates` now includes `"callback_query"` (was only `"message"`)
- `answerCallbackQuery` API call removes "loading" indication on button click

### 3. **IncomingMessage Interface** (`src/bot.ts`)
Extended `sendText` signature to support inline buttons:
```typescript
sendText: (text: string, suggestions?: string[], inlineButtons?: Array<{ text: string; callback_data: string }>[]) => Promise<void>;
```

## User Experience

### For Admin
1. Receives message from Linda with command buttons
2. Clicks any button (e.g., "Показать все сессии")
3. Button click is acknowledged with instant feedback (no loading spinner)
4. Linda processes the button press like a typed command

### For Clients
- Behavior unchanged — clients still see regular text suggestions if available
- No inline buttons for client messages

## Commands Available (Button Grid)

| Button Label | Command | Purpose |
|---|---|---|
| 📋 Все сессии | `/sessions` | List all sessions |
| 🔍 Деталь сессии | `/session` | Get full session details |
| ✉️ Отправить сообщение | `/send` | Send message to client |
| ✏️ Отредактировать | `/override` | Edit session field |
| 🔄 Сбросить контекст | `/reset` | Reset chat state |
| 🏢 Настройки фирмы | `/firm` | Show firm config |

## Technical Notes

- Inline keyboard is a **grid layout** (2 buttons per row, 3 rows = 6 buttons total)
- Callback button press sends `callback_query` to Linda's long-polling loop
- Messages are split into chunks (max 3900 chars); buttons only appear on last chunk
- Admin role is determined by `state.role === "admin"` in bot.ts
- Access control applies to button presses same as text messages

## Build & Deployment

```bash
cd packages/linda
npm run build
node dist/main.js
```

Linda is auto-restarted to pick up the new feature.

## Testing

1. Run intake: `node scripts/intake-clean-run.mjs`
2. Admin receives notification in Telegram
3. Admin clicks any button to execute command
4. Linda processes button click and responds with results

---

**Date:** 2026-04-11  
**Modified files:**
- `src/bot.ts` — Added inline_buttons to admin responses
- `src/telegram.ts` — Callback query handling + inline_keyboard support
