#!/bin/bash
set -e
cd /opt/wanying
echo "[2026年 7月27日 星期一 15时24分54秒 CST] Starting deployment..."
git pull origin main
npm install --production=false
npm run build
pm2 restart wanying
echo "[2026年 7月27日 星期一 15时24分54秒 CST] Deployment complete!"
