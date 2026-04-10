# Linda Conversational Agent

Интеллектуальный слой между пользователем и **PSF Engine (Canon)**. Работает в Telegram, WhatsApp и через терминальный интерфейс (TUI).

**Архитектура:** один Linda-инстанс = одна фирма. Tenancy задаётся на уровне деплоя через `FIRM_ID`.

---

## Быстрый старт

### 1. Сборка

```bash
cd packages/linda
npm install
npm run build
npm link   # опционально — чтобы запускать linda/linda-create-firm глобально
```

### 2. Создание .env для фирмы

Интерактивный wizard (3 блока: фирма / WhatsApp / Telegram):

```bash
linda-create-firm
```

Или non-interactive для CI / скриптов:

```bash
linda-create-firm --config='{"firmId":"acme_law_il","firmName":"Acme Law","activePacks":["relocation_v1"],"psfBaseUrl":"http://localhost:3000","psfSecret":"secret","tgEnabled":true,"tgToken":"bot:123","tgAllowedUserIds":"253432559","waEnabled":false}'
```

Или скопировать `.env.example` и заполнить вручную — там три блока с комментариями.

### 3. Запуск

```bash
linda          # daemon-режим: Telegram + WhatsApp (по конфигу)
linda --tui    # терминальный UI (client role)
linda --tui --admin  # TUI в admin role
```

---

## Структура .env

```env
# Block 1 — Firm Identity
FIRM_ID=acme_law_il
FIRM_NAME=Acme Law IL
FIRM_ACTIVE_PACKS=relocation_v1
FIRM_DEFAULT_PACK_ID=relocation_v1   # пропустить intent detection
FIRM_LANGUAGE=ru
FIRM_TONE=warm

# Block 2 — Client Agent (WhatsApp)
WHATSAPP_ENABLED=false
WHATSAPP_AUTH_DIR=./.linda/auth/acme_law_il-whatsapp
# WHATSAPP_ALLOWED_USER_IDS=+972501234567

# Block 3 — Admin Agent (Telegram)
TELEGRAM_ADMIN_ENABLED=true
TELEGRAM_BOT_TOKEN=bot:...
TELEGRAM_ALLOWED_USER_IDS=253432559   # рекомендуется для prod

# Infrastructure
PSF_BASE_URL=http://localhost:3000
PSF_SHARED_SECRET=your_secret
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-5
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Совместный запуск PSF + Linda (dev)

Из корня монорепозитория:

```bash
npm run build -w @psf/linda; taskkill /F /IM node.exe; sleep 3; npx concurrently --names "PSF,LINDA" --prefix-colors "blue,green" "npm run --prefix ../psf-engine-v2 template:canon:web:dev" "node packages/linda/dist/main.js"
```

- **`[PSF]`** — Next.js бэкенд в `../psf-engine-v2/products/product-template-canon`: API routes, Neon DB, state machine
- **`[LINDA]`** — `packages/linda/dist/main.js`: LLM, tools, Baileys, Telegram polling, BridgeRegistry

---

## Tenant Isolation

Каждый запрос к PSF несёт `firmId`:

| Концепт | Формат |
|---|---|
| Chat key (guardrails, memory) | `${firmId}:${channel}:${chatId}` |
| Actor ID (PSF session) | `user_${ch}_${firmId}_${userId}` |
| Channel key (PSF state) | `${firmId}:${channel}:${userId}` |

Пакеты из `FIRM_ACTIVE_PACKS` — это allowlist. `assertPackAllowed()` блокирует любую попытку запустить неразрешённый pack до вызова PSF.

---

## Роли и каналы

| | Client (WhatsApp) | Admin (Telegram) |
|---|---|---|
| Prompt | Тёплый, пошаговый | Деловой, прямой |
| Tools | `submit_data` | + `list_sessions`, `view_session`, `add_note`, `override_field`, `send_to_client` |
| Guardrails | Строгие | Расслабленные |
| Intent fallback | Активен | Отключён |

---

## Ops

### Telegram polling
Правило: один `TELEGRAM_BOT_TOKEN` — один polling-процесс. При конфликте (409) убедитесь, что старый процесс остановлен перед запуском нового.

### Legacy данные
Исторические сессии (до tenant-режима) могут иметь `firm_id = null` в БД. Это не ломает текущий flow, но они не попадут в `GET /api/admin/sessions?firmId=...`.

---

## Тесты

```bash
npm test
```

6 файлов, 84+ тестов: validation, redact, guardrails, roles (с FirmConfig), intents, logger.

---

## Документация

Подробная архитектурная документация: [`ARCHITECTURE.md`](./ARCHITECTURE.md)

- Turn pipeline (8 шагов)
- Guardrails scoring algorithm
- Validation layers
- PSF protocol (все 3 endpoint'а с firmId)
- Полная таблица env vars
- Tech debt / known gaps
