#!/bin/bash

# --- Configuration ---
APP_NAME="lists-and-prices"
# When run as `sudo ./deploy.sh`, $HOME becomes /root. Use SUDO_USER to resolve
# the real user's home directory, falling back to $HOME if run without sudo.
REAL_HOME=$(getent passwd "${SUDO_USER:-$USER}" | cut -d: -f6)
SOURCE_DIR="$REAL_HOME/other_git/list-prices-svelte5"
DEST_DIR="/opt/lists_and_prices"
SERVICE_NAME="lists-and-prices.service"

echo "🚀 Starting deployment for $APP_NAME..."

# 1. Build the Svelte 5 frontend
echo "📦 Building Svelte frontend..."
cd "$SOURCE_DIR"
npm run build

# 2. Sync files to /opt
# We include 'server' and 'dist' (assuming that's your build output)
echo "🔄 Syncing files to $DEST_DIR..."
sudo rsync -av --delete \
    --exclude=".git/" \
    --exclude="node_modules/" \
    --exclude="src/" \
    --exclude="deploy.sh" \
    "$SOURCE_DIR/" "$DEST_DIR/"

# 3. Permissions
echo "🔐 Setting permissions..."
sudo chown -R www-data:www-data "$DEST_DIR"

# 4. Install production dependencies in /opt
echo "📥 Checking dependencies..."
sudo -u www-data npm install --prefix "$DEST_DIR" --omit=dev

# 4a. Rebuild native addons against the current Node version
echo "🔧 Rebuilding native addons..."
sudo -u www-data npm rebuild --prefix "$DEST_DIR"

# 5. Restart the service
echo "♻️  Restarting $SERVICE_NAME..."
sudo systemctl restart "$SERVICE_NAME"

echo "✅ Deployment complete! Checking logs..."
sudo journalctl -u "$SERVICE_NAME" -n 20 --no-pager
