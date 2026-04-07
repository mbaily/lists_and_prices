#!/bin/bash

# --- Configuration ---
APP_NAME="lists-and-prices"
SOURCE_DIR="$HOME/other_git/lists_and_prices"
DEST_DIR="/opt/lists_and_prices"
SERVICE_NAME="lists-and-prices.service"

echo "🚀 Starting deployment for $APP_NAME..."

# 1. Build the Svelte app in the dev folder first
echo "📦 Building Svelte app..."
npm run build

# 2. Sync files to /opt
# We include server/ because of your index.ts and .htpasswd
echo "🔄 Syncing files to $DEST_DIR..."
sudo rsync -av --delete \
    --exclude=".git/" \
    --exclude="node_modules/" \
    --exclude=".vscode/" \
    --exclude="src/" \
    --exclude="deploy.sh" \
    "$SOURCE_DIR/" "$DEST_DIR/"

# 3. Ensure permissions
echo "🔐 Setting permissions..."
sudo chown -R www-data:www-data "$DEST_DIR"

# 4. Install production dependencies in /opt
echo "📥 Installing dependencies..."
sudo -u www-data npm install --prefix "$DEST_DIR" --omit=dev

# 5. Restart the service
echo "♻️  Restarting $SERVICE_NAME..."
sudo systemctl restart "$SERVICE_NAME"

echo "✅ Deployment complete!"
sudo journalctl -u "$SERVICE_NAME" -n 20 --no-pager
