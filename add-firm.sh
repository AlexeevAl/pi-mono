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

echo "🚀 Setting up new firm: $FIRM_NAME..."

# 1. Create directory structure
mkdir -p "$FIRM_DIR/wa-auth"

# 2. Copy .env template if not exists
if [ ! -f "$FIRM_DIR/.env" ]; then
    if [ -f "firms/alpha/.env.example" ]; then
        cp "firms/alpha/.env.example" "$FIRM_DIR/.env"
        # Update FIRM_ID in the new .env
        sed -i "s/FIRM_ID=.*/FIRM_ID=${FIRM_NAME}/" "$FIRM_DIR/.env"
        echo "✅ Created .env for $FIRM_NAME (don't forget to add API keys!)"
    else
        echo "⚠️  Warning: firms/alpha/.env.example not found. Please create .env manually."
    fi
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
    
    # Also update port in .env
    sed -i "s/WEB_PORT=.*/WEB_PORT=3034/" "$FIRM_DIR/.env"
    
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
