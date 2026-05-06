#!/bin/bash

# ============================================================================
# Linda Agent — Interactive Firm Setup
# ============================================================================

echo "--------------------------------------------------------"
echo "🌟 LINDA AGENT — НОВЫЙ КЛИЕНТ"
echo "--------------------------------------------------------"

read -p "Введите ID фирмы (латиницей, например 'alpha'): " FIRM_ID
if [ -z "$FIRM_ID" ]; then echo "Ошибка: ID обязателен"; exit 1; fi

read -p "Введите название фирмы (например, 'Альфа Клиник'): " FIRM_NAME
if [ -z "$FIRM_NAME" ]; then FIRM_NAME=$FIRM_ID; fi

FIRM_DIR="firms/$FIRM_ID"
COMPOSE_FILE="docker-compose.yml"

# 1. Создаем папки
mkdir -p "$FIRM_DIR/wa-auth"
touch "$FIRM_DIR/settings.json"

# 2. Создаем .env (минимальный)
if [ ! -f "$FIRM_DIR/.env" ]; then
    cat <<EOF > "$FIRM_DIR/.env"
FIRM_ID=$FIRM_ID
FIRM_NAME=$FIRM_NAME
WEB_ENABLED=true
WEB_PORT=3034
WHATSAPP_ENABLED=true
TELEGRAM_ENABLED=true
OPENAI_API_KEY=ВСТАВЬ_СВОЙ_КЛЮЧ_ЗДЕСЬ
EOF
    echo "✅ Создан .env файл в $FIRM_DIR"
fi

# 3. Добавляем в docker-compose.yml
if grep -q "linda-$FIRM_ID:" "$COMPOSE_FILE"; then
    echo "ℹ️  Фирма уже есть в docker-compose.yml"
else
    # Ищем последний порт
    LAST_PORT=$(grep -oE "303[0-9]" "$COMPOSE_FILE" | sort -nr | head -n1)
    if [ -z "$LAST_PORT" ]; then LAST_PORT=3033; fi
    NEW_PORT=$((LAST_PORT + 1))

    cat <<EOF >> "$COMPOSE_FILE"

  linda-$FIRM_ID:
    <<: *linda-base
    container_name: linda-$FIRM_ID
    ports:
      - "$NEW_PORT:3034"
    volumes:
      - ./$FIRM_DIR/wa-auth:/app/packages/linda-agent/data/wa-auth
      - ./$FIRM_DIR/.env:/app/packages/linda-agent/.env
      - ./$FIRM_DIR/settings.json:/app/settings.json
EOF
    echo "✅ Добавлена фирма в docker-compose (Порт: $NEW_PORT)"
fi

# 4. Запуск
echo "--------------------------------------------------------"
echo "🚀 Запускаю контейнер..."
docker compose up -d --build "linda-$FIRM_ID"

# 5. Итог
SERVER_IP=$(curl -s https://ifconfig.me)
echo "--------------------------------------------------------"
echo "🎉 ВСЁ ГОТОВО!"
echo "Фирма: $FIRM_NAME"
echo "Ссылка для настройки (отправь клиенту):"
echo "http://$SERVER_IP:$NEW_PORT/setup"
echo "--------------------------------------------------------"
echo "P.S. Не забудь вписать OPENAI_API_KEY в $FIRM_DIR/.env"
