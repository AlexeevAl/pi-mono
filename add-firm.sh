#!/bin/bash

# ============================================================================
# Linda Agent — Add New Firm Script
# ============================================================================

if [ -z "$1" ]; then
    echo "Usage: ./add-firm.sh <firm_name>"
    exit 1
fi

FIRM_NAME=$1
FIRM_DIR="firms/$FIRM_NAME"
COMPOSE_FILE="docker-compose.yml"

upsert_env() {
    local file=$1
    local key=$2
    local value=$3

    if grep -q "^$key=" "$file"; then
        sed -i "s|^$key=.*|$key=$value|" "$file"
    else
        printf '%s=%s\n' "$key" "$value" >> "$file"
    fi
}

echo "🚀 Setting up new firm: $FIRM_NAME..."

# 1. Create directory structure
mkdir -p "$FIRM_DIR/wa-auth"

# 2. Copy .env template if not exists
if [ ! -f "$FIRM_DIR/.env" ]; then
    ENV_TEMPLATE=$(find firms -mindepth 2 -maxdepth 2 \( -name ".env.example" -o -name ".env" \) ! -path "$FIRM_DIR/.env" | sort | head -n1)

    if [ -n "$ENV_TEMPLATE" ]; then
        cp "$ENV_TEMPLATE" "$FIRM_DIR/.env"
        echo "✅ Created .env for $FIRM_NAME from $ENV_TEMPLATE"
    else
        cat <<EOF > "$FIRM_DIR/.env"
FIRM_ID=$FIRM_NAME
LOCALE=ru
PSF_ENGINE_URL=${PSF_ENGINE_URL:-http://localhost:3050}
EDGE_ID=linda-$FIRM_NAME-edge
FIRM_SHARED_SECRET=${FIRM_SHARED_SECRET:-${BRIDGE_SHARED_SECRET:-psf_hermes_secret_123}}
LLM_PROVIDER=${LLM_PROVIDER:-openai}
LLM_MODEL=${LLM_MODEL:-gpt-5.4-nano}
WEB_ENABLED=true
WEB_ROLE=client
WEB_PORT=3034
WHATSAPP_ENABLED=false
TELEGRAM_ENABLED=false
EOF
        echo "✅ Created minimal .env for $FIRM_NAME"
    fi

    upsert_env "$FIRM_DIR/.env" "FIRM_ID" "$FIRM_NAME"
    upsert_env "$FIRM_DIR/.env" "EDGE_ID" "linda-$FIRM_NAME-edge"
    upsert_env "$FIRM_DIR/.env" "WEB_PORT" "3034"
fi

# 3. Add to docker-compose.yml if not already there
if grep -q "linda-$FIRM_NAME:" "$COMPOSE_FILE"; then
    echo "ℹ️  Firm $FIRM_NAME already exists in $COMPOSE_FILE"
else
    # Find the last used port for web
    LAST_PORT=$(grep "303" "$COMPOSE_FILE" | grep -oE "[0-9]{4}" | sort -nr | head -n1)
    if [ -z "$LAST_PORT" ]; then LAST_PORT=3033; fi
    NEW_PORT=$((LAST_PORT + 1))

    # Append new service block
    cat <<EOF >> "$COMPOSE_FILE"

  linda-$FIRM_NAME:
    <<: *linda-base
    container_name: linda-$FIRM_NAME
    ports:
      - "$NEW_PORT:3034"
    volumes:
      - ./$FIRM_DIR/wa-auth:/app/packages/linda-agent/data/wa-auth
      - ./$FIRM_DIR/.env:/app/packages/linda-agent/.env
EOF
    
    echo "✅ Added linda-$FIRM_NAME to $COMPOSE_FILE on port $NEW_PORT"
fi

echo "--------------------------------------------------------"
echo "Done! Next steps:"
echo "1. Edit $FIRM_DIR/.env to add your API keys."
echo "2. Run: docker compose up -d --build"
echo "--------------------------------------------------------"

if [ "${AUTO_START:-0}" = "1" ]; then
    echo "AUTO_START=1, starting linda-$FIRM_NAME..."
    docker compose up -d --build "linda-$FIRM_NAME"
fi
