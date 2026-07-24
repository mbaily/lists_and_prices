#!/bin/bash

# Configuration
SOURCE_DIR="/opt/lists_and_prices/server/yjs-data"
BACKUP_DIR="/root"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/yjs-data-backup-${TIMESTAMP}.tar.gz"

# (Optional but recommended) Service name to stop/start 
# Change 'lists_and_prices' to your actual PM2 or systemd service name, 
# or comment these lines out if you don't mind risking a hot backup.
SERVICE_NAME="lists_and_prices"

echo "Starting Yjs data backup..."

# 1. Stop the server to ensure database consistency (LevelDB is sensitive to live copying)
# systemctl stop $SERVICE_NAME
# pm2 stop $SERVICE_NAME 

# 2. Check if source directory exists
if [ ! -d "$SOURCE_DIR" ]; then
  echo "Error: Source directory $SOURCE_DIR does not exist."
  exit 1
fi

# 3. Create the tarball
# Using -C changes the directory before tarring, so the archive just contains 'yjs-data/...'
# instead of the full absolute path '/opt/lists_and_prices/server/yjs-data/...'
tar -czvf "$BACKUP_FILE" -C /opt/lists_and_prices/server yjs-data

# 4. Restart the server
# systemctl start $SERVICE_NAME
# pm2 start $SERVICE_NAME

# 5. Verify the backup file was created
if [ -f "$BACKUP_FILE" ]; then
  echo "✅ Backup successfully created at: $BACKUP_FILE"
else
  echo "❌ Backup failed."
  exit 1
fi
