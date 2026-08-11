# 長期公開網站部署說明

這個系統已整理成可部署到雲端主機的 Node.js 網站，不需要再依賴 Cloudflare quick tunnel。

## 目前已準備好的部署檔

- `server.js`：正式網站伺服器，支援登入、Session、帳號管理與靜態檔保護。
- `package.json`：使用 `npm start` 啟動。
- `Dockerfile`：可部署到 VPS、NAS、雲端 VM 或容器平台。
- `render.yaml`：Render Blueprint/Web Service 設定。
- `railway.json`：Railway 部署與健康檢查設定。
- `Procfile`：支援 Heroku/Render 類平台。
- `.env.example`：環境變數範例。

## 推薦方式一：Render

1. 將專案上傳到 GitHub repository。
2. 到 Render 建立 `New Web Service`。
3. 連接該 GitHub repository。
4. 設定：
   - Runtime: `Node`
   - Build Command: 留空或使用 `npm install`
   - Start Command: `npm start`
   - Health Check Path: `/api/health`
5. Environment Variables:
   - `HOST=0.0.0.0`
   - `DATA_ROOT=/var/data`
6. 新增 Persistent Disk：
   - Mount Path: `/var/data`
   - Size: 1 GB 或以上
7. Deploy。

部署完成後，Render 會提供一個長期網址，例如：

```text
https://your-service-name.onrender.com
```

## 推薦方式二：Railway

1. 將專案上傳到 GitHub repository。
2. 到 Railway 建立 `New Project`，選擇 `Deploy from GitHub repo`。
3. Railway 會讀取 `railway.json`。
4. 設定 Environment Variables：
   - `HOST=0.0.0.0`
   - `DATA_ROOT=/data`
5. 如果要保留帳號資料，請設定 volume 並掛載到 `/data`。
6. Deploy。

## 推薦方式三：VPS / Docker

在主機上執行：

```bash
docker build -t global-market-dashboard .
docker run -d \
  --name global-market-dashboard \
  --restart unless-stopped \
  -p 8080:8080 \
  -v market-dashboard-data:/app/.data \
  global-market-dashboard
```

然後將網域或反向代理指到該主機的 `8080`，建議使用 Nginx/Caddy 加 HTTPS。

## 帳號資料

如果部署環境沒有既有 `.data/users.json`，系統會自動建立：

- 帳號：`admin`
- 初始密碼：`Admin@2026!`

第一次登入後會被要求變更密碼。

如果要沿用本機帳號，將本機 `.data/users.json` 複製到雲端的 `DATA_ROOT/users.json`。

## 健康檢查

部署後可用以下網址確認服務狀態：

```text
https://你的網域/api/health
```

正常會回傳：

```json
{"ok":true}
```

## 為什麼不用目前的 Cloudflare quick tunnel

目前本機網路會阻擋 Cloudflare Tunnel 連到 edge 的 `7844` 連線，造成公開網址回 `530`。即使短期修好，quick tunnel 也不是長期正式網站方案。正式部署應放到 Render、Railway、Fly.io、VPS 或其他雲端主機。
