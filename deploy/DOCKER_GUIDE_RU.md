# Инструкция по развертыванию агентов Linda через Docker

Эта система позволяет запускать независимые экземпляры агентов для каждой фирмы на одном VPS.

## 1. Подготовка папок на сервере
Для каждой фирмы мы будем держать настройки и сессии WhatsApp в отдельной папке.

Рекомендуемая структура на сервере:
```text
/opt/linda/
  ├── Dockerfile            # Из корня репозитория
  ├── docker-compose.yml    # Из корня репозитория
  └── firms/
      ├── alpha/
      │   ├── .env          # Настройки фирмы Alpha
      │   └── wa-auth/      # Здесь сохранится QR-код
      └── beta/
          ├── .env
          └── wa-auth/
```

Команды для создания:
```bash
mkdir -p /opt/linda/firms/alpha/wa-auth
mkdir -p /opt/linda/firms/beta/wa-auth
```

## 2. Настройка .env для каждой фирмы
В файл `/opt/linda/firms/alpha/.env` вставьте настройки для конкретной фирмы:
```env
FIRM_ID=alpha-clinic
PSF_ENGINE_URL=http://your-backend:3050
FIRM_SHARED_SECRET=your_secret
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Каналы
WHATSAPP_ENABLED=true
TELEGRAM_ENABLED=false
# Если нужен веб-чат:
WEB_ENABLED=true
WEB_PORT=3034
```

## 3. Сборка и запуск
Из папки `/opt/linda/` выполните:
```bash
# Собрать образ (один раз для всех фирм)
docker compose build

# Запустить всех агентов
docker compose up -d
```

## 4. Как отсканировать WhatsApp QR-код
Для каждой новой фирмы нужно один раз отсканировать код:
1. Запустите логи конкретного контейнера:
   ```bash
   docker logs -f linda-alpha
   ```
2. В терминале появится QR-код. Отсканируйте его телефоном.
3. Сессия автоматически сохранится в папку `./firms/alpha/wa-auth/` на сервере и не пропадет при перезагрузке.

## 5. Обновление кода
Когда вы вносите изменения в код агентов:
1. Подтяните изменения из Git: `git pull`.
2. Пересоберите образ: `docker compose build`.
3. Перезапустите контейнеры: `docker compose up -d`.
   *Docker поймет, что образ обновился, и перезапустит только те контейнеры, где это нужно.*

## Полезные команды
- `docker compose ps` — проверить статус всех агентов.
- `docker compose stop linda-alpha` — остановить агента конкретной фирмы.
- `docker compose logs --tail=100 -f` — смотреть логи всех агентов сразу.
