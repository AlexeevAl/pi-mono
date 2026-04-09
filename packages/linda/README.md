# 🤖 Linda Conversational Agent

Linda — это интеллектуальный слой между пользователем и **PSF Engine (Canon)**. Она умеет работать как в Telegram, так и через продвинутый терминальный интерфейс (TUI).

## 🚀 Быстрый старт

### 1. Установка (Глобально)
Чтобы запускать Линду из любого места вашей системы:
```bash
cd packages/linda
npm install
npm run build
npm link
```

### 2. Настройка окружения
Создайте файл `.env` в директории, откуда планируете запускать Линду:
```env
PSF_BASE_URL=http://localhost:3033
PSF_SHARED_SECRET=ваш_секрет
TELEGRAM_BOT_TOKEN=ваш_токен
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-5
ANTHROPIC_API_KEY=ваш_ключ
```

## 🖥 Режимы работы

### Терминальный интерфейс (TUI)
Тот самый «хакерский» вид, как у основного агента Pi:
```bash
linda --tui
```
*Управление:*
- `Enter`: отправить сообщение.
- `Стрелки Вверх/Вниз`: навигация по истории команд.
- `Ctrl+C`: выход.

### Telegram Бот
Запуск в режиме фонового бота:
```bash
linda
```
Линда автоматически добавит кнопки с предложениями (suggestions) из сценария PSF.

## 🛠 Разработка
Если вы вносите изменения в код:
1. Выполните `npm run build` для компиляции.
2. Линда подхватит изменения автоматически, если вы используете `linda --tui`.

### Совместный запуск с PSF Engine (dev-режим)

Для локальной разработки кросс-канальных фич (Telegram + WhatsApp) и логики администратора (отправка сообщений клиентам напрямую) требуется одновременный запуск движка PSF и бота Линды. Рекомендуется использовать эту команду из корня монорепозитория (`pi-mono`):

```bash
npm run build -w @psf/linda; taskkill /F /IM node.exe; sleep 3; npx concurrently --names "PSF,LINDA" --prefix-colors "blue,green" "npm run --prefix ../psf-engine-v2 template:canon:web:dev" "node packages/linda/dist/main.js"
```

**Что именно запускается:**
1. Сначала пересобирается (`build`) TypeScript-код Линды.
2. Закрываются все старые Node-процессы через `taskkill /F /IM node.exe`, чтобы освободить порт 3033 и "отстрелить" зависшие подключения WhatsApp/Telegram.
3. `concurrently` запускает параллельно два компонента с цветным логированием:
   - События с префиксом **`[PSF]`** — это Next.js бэкенд в соседней папке `../psf-engine-v2/products/product-template-canon`. Там крутятся API (например, `/api/linda/turn` и `/api/admin/sessions`), база данных и стейт-машина клиентского процесса.
   - События с префиксом **`[LINDA]`** — это исполняемый входной файл `packages/linda/dist/main.js`. В нём поднимается LLM-посредник, инструменты, WhatsApp-библиотека Baileys, long-polling Telegram и реестр прямого сообщения `BridgeRegistry`.
