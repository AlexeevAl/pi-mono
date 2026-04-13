# @psf/linda-agent

Операционный пакет системы Linda — два специализированных AI-агента, построенных поверх [`pi-agent-core`](../../packages/agent), с каналами для WhatsApp и Telegram.

---

## Принципы архитектуры

### Backend-First, Stateless

Агенты не хранят состояние диалога локально. Перед каждым ходом они запрашивают `ClubAgentContext` у `psf-engine-v2`. Движок — единственный источник правды.

```
WhatsApp → WhatsAppChannel → LindaClientAgent → GET /api/agent/context
                                               → LLM + client tools
                                               → POST /api/tools/*
                                               → reply

Telegram → TelegramChannel → LindaAdminAgent  → GET /api/admin/sessions
                                               → LLM + admin tools
                                               → POST /api/admin/tools/*
                                               → reply
```

### Разделение по роли — на уровне сборки

Один общий `core/`, два role-specific агента поверх него. Нет единого класса с `if (role === "admin")`.

```
              pi-agent-core (Agent, AgentTool)
                      ↑
           src/core/  (shared infrastructure)
         ↑                        ↑
LindaClientAgent         LindaAdminAgent
  (WhatsApp / client)    (Telegram / admin)
```

---

## Структура пакета

```
packages/linda-agent/
  src/
    core/
      types.ts            — все типы (LindaRuntimeConfig, DecideInput, AgentDecision)
      backend-client.ts   — ClinicBackendClient (shared HTTP client)
      skills-loader.ts    — SkillsLoader (загрузка SKILL.md из файловой системы)
      base-agent.ts       — createAgent(), extractTextContent() (shared factory)

    agents/
      LindaClientAgent.ts — клинический ассистент (WhatsApp, role=client_agent)
      LindaAdminAgent.ts  — операционный ассистент (Telegram, role=admin_agent)

    channels/
      WhatsAppChannel.ts  — Baileys-адаптер → LindaClientAgent
      TelegramChannel.ts  — long-polling-адаптер → LindaAdminAgent

    tools/
      client-tools.ts     — клинические инструменты (submit_profile_answers и др.)
      admin-tools.ts      — управление сессиями (list_sessions, send_to_client и др.)

    policies/
      shared-hooks.ts     — shared hooks (onToolExecutionStart/End)

    config.ts             — buildRuntimeConfig() из env-переменных
    index.ts              — публичный API пакета

  skills/
    manager/              — базовая личность клинического менеджера
    profile_enrichment/   — навык сбора данных пациента
    booking_consultation/ — навык записи на консультацию
    admin_assistant/      — личность операционного ассистента (Telegram)
```

---

## Конфигурация

Конфигурация строится через `buildRuntimeConfig()` из переменных окружения.

Создайте `.env` в корне пакета:

```env
# Backend
PSF_ENGINE_URL=http://localhost:3050
FIRM_ID=linda-clinic
FIRM_SHARED_SECRET=psf_hermes_secret_123
EDGE_ID=linda-local-edge

# LLM
LLM_PROVIDER=anthropic
LLM_MODEL=claude-3-5-sonnet-20241022
ANTHROPIC_API_KEY=sk-ant-...

# Admin access (Telegram user IDs через запятую)
ALLOWED_ADMIN_IDS=123456789,987654321

# Локализация
LOCALE=ru
```

### Тип конфига

```ts
type LindaRuntimeConfig = {
  backend: BackendConfig;     // URL движка, секреты, edgeId
  llm: LlmConfig;             // провайдер и модель
  shared: SharedAgentConfig;  // firmId, locale, skillsDir
  clientAgent: {
    enabledSkills: ClientSkillId[];
    defaults: { channel: "whatsapp" | "web" };
  };
  adminAgent: {
    enabledSkills: AdminSkillId[];
    allowedAdminIds: string[];  // пустой массив = доступ для всех
    defaults: { channel: "telegram" | "web" };
  };
};
```

---

## Использование

### Минимальный запуск

```ts
import {
  buildRuntimeConfig,
  LindaClientAgent,
  LindaAdminAgent,
  WhatsAppChannel,
  TelegramChannel,
} from "@psf/linda-agent";

const config = buildRuntimeConfig();

// Агенты
const clientAgent = new LindaClientAgent(config);
const adminAgent = new LindaAdminAgent(config);

// Каналы
const whatsapp = new WhatsAppChannel(
  { authDir: "./data/wa-auth" },
  clientAgent
);

const telegram = new TelegramChannel(
  { token: process.env.TG_BOT_TOKEN! },
  adminAgent
);

// Старт
await Promise.all([whatsapp.start(), telegram.start()]);
```

### Прямой вызов агента (без каналов)

```ts
// Клиент
const clientAgent = new LindaClientAgent(config);
const result = await clientAgent.decide({
  clientId: "user_wa_79991234567",
  text: "Здравствуйте, хочу записаться",
  channel: "whatsapp",
});
console.log(result.reply);

// Администратор — глобальный режим
const adminAgent = new LindaAdminAgent(config);
const overview = await adminAgent.decide({
  adminId: "tg_123456789",
  text: "Покажи активные сессии",
  channel: "telegram",
});

// Администратор — режим конкретного клиента
const targeted = await adminAgent.decide({
  adminId: "tg_123456789",
  targetClientId: "user_wa_79991234567",
  text: "Что у неё в анкете?",
  channel: "telegram",
});
```

---

## Агенты

### LindaClientAgent

| Параметр | Значение |
|---|---|
| Роль | `client_agent` (фиксированно) |
| Канал по умолчанию | `whatsapp` |
| Скилл по умолчанию | `manager` |
| Инструменты | `submit_profile_answers`, `get_missing_fields`, `log_interest_signal`, `escalate_to_human` |

**Поведение**: перед каждым ходом запрашивает `ClubAgentContext` от движка. На основе `activeSkill` выбирает `SKILL.md` и строит system prompt с целью разговора и статусом отношений.

### LindaAdminAgent

| Параметр | Значение |
|---|---|
| Роль | `admin_agent` (фиксированно) |
| Канал по умолчанию | `telegram` |
| Скилл по умолчанию | `admin_assistant` |
| Инструменты | `list_sessions`, `view_session`, `add_note`, `override_field`, `send_to_client` |

**Два режима работы**:
- **Global**: `targetClientId` не указан → обзор, поиск, SLA-события
- **Targeted**: `targetClientId` указан → операции с конкретным клиентом

**Безопасность**: если `allowedAdminIds` непустой, запросы от неизвестных `adminId` отклоняются без вызова LLM.

**Синтаксис таргетинга в Telegram**: префикс `@clientId` в сообщении автоматически извлекается как `targetClientId`:
```
@user_wa_79991234567 Отправь ей сообщение о записи на завтра
```

---

## Каналы

### WhatsAppChannel

Использует [Baileys](https://github.com/WhiskeySockets/Baileys) (WhatsApp Web protocol).

```ts
new WhatsAppChannel(
  {
    authDir: "./data/wa-auth",        // Путь для хранения сессии
    allowedPhoneNumbers: ["79991234567"], // Опционально: allowlist
  },
  clientAgent
);
```

- При первом запуске выводит QR-код в терминал.
- Автоматически переподключается при обрыве.
- Игнорирует отправленные им самим сообщения (echo guard).

### TelegramChannel

Long-polling без внешних библиотек (чистый `fetch`).

```ts
new TelegramChannel(
  {
    token: "BOT_TOKEN",
    allowedUserIds: [123456789],     // Опционально: numeric Telegram user IDs
    pollTimeoutSec: 30,              // Default: 30
  },
  adminAgent
);
```

Зарегистрированные команды в боте:
| Команда | Описание |
|---|---|
| `/sessions` | Активные сессии клиентов |
| `/session` | Детали конкретной сессии |
| `/send` | Написать клиенту |
| `/override` | Изменить поле анкеты |
| `/start` | Начать работу |

---

## Скиллы (Personas)

Каждый скилл — папка в `skills/<skill_id>/SKILL.md`. Файл загружается как system prompt для LLM.

Подробное описание доступных скиллов и руководство по их созданию читайте в [**SKILLS.md**](./SKILLS.md).

| Скилл | Роль | Описание |
|---|---|---|
| `manager` | client_agent | Базовая личность клинического менеджера |
| `profile_enrichment` | client_agent | Сбор данных в анкету (включая ссылки на UI) |
| `booking_consultation` | client_agent | Запись на консультацию |
| `admin_assistant` | admin_agent | Операционный ассистент для Telegram |

### Добавление скилла

1. Создайте папку `skills/<your_skill_id>/`
2. Добавьте `SKILL.md` с описанием личности и правилами поведения
3. Добавьте `skill_id` в `enabledSkills` в конфиге

Движок возвращает `activeSkill` в `ClubAgentContext` — агент автоматически загрузит нужный файл.

---

## Backend API Contract

Оба агента общаются с `psf-engine-v2` через стандартные заголовки:

```
Authorization: Bearer <FIRM_SHARED_SECRET>
X-PSF-Edge-Id: <EDGE_ID>
X-PSF-Agent-Role: client_agent | admin_agent
X-PSF-Channel: whatsapp | telegram | web
```

### Эндпоинты (Client)
| Метод | URL | Описание |
|---|---|---|
| `GET` | `/api/agent/context/:clientId` | Получить контекст клиента |
| `POST` | `/api/tools/submit-profile-answers` | Записать данные анкеты |
| `POST` | `/api/tools/escalate-to-human` | Эскалация к оператору |

### Эндпоинты (Admin)
| Метод | URL | Описание |
|---|---|---|
| `GET` | `/api/admin/sessions` | Список сессий |
| `GET` | `/api/admin/sessions/:id` | Детали сессии |
| `POST` | `/api/admin/tools/add-note` | Внутренняя заметка |
| `POST` | `/api/admin/tools/override-field` | Изменить поле |
| `POST` | `/api/admin/tools/send-to-client` | Отправить клиенту |

---

## Разработка

```bash
# Сборка
npm run build

# Локальный запуск с .env
node dist/main.js
```

Переменные для отладки:
```env
PSF_ENGINE_URL=http://localhost:3050   # движок запущен локально
ALLOWED_ADMIN_IDS=                     # пустой = любой admin (только для dev!)
```
