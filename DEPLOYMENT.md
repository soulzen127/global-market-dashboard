# Internet Deployment

> Updated 2026-10-09: see SYSTEM_HEALTH_2026-10-09.md for the current release status. The free deployment target is Vercel plus external PostgreSQL. The older Render persistent-disk instructions below describe a paid-disk alternative, not the current free render.yaml configuration. Install dependencies with `npm install --omit=dev` before starting Node.

This project now has a production-style Node.js server (`server.js`) in addition to the local PowerShell server.

## Recommended Hosting

Use a real web host instead of Cloudflare quick tunnels for long-running public access. Quick tunnels can expire and this network currently blocks Cloudflare Tunnel edge traffic on port `7844`.

Good options:

- Render Web Service
- Railway
- Fly.io
- Any VPS with Docker

## Render Deployment

1. Push this folder to a Git repository.
2. Create a Render Web Service from the repository.
3. Use:
   - Runtime: Node
   - Build command: empty
   - Start command: `npm start`
   - Environment variable: `DATA_ROOT=/var/data`
4. Add a persistent disk mounted at `/var/data`.
5. Deploy.

The `render.yaml` file contains the same settings for blueprint deployment.

## Docker Deployment

Build:

```powershell
docker build -t global-market-dashboard .
```

Run:

```powershell
docker run -d --name global-market-dashboard -p 8080:8080 -v market-dashboard-data:/app/.data global-market-dashboard
```

Then publish the server through your host firewall, reverse proxy, or cloud provider load balancer.

## First Login

For a new database, set `INITIAL_SUPERVISOR_PASSWORD` securely in the host environment to provision `soulzen127@gmail.com`. There is no built-in default password. Existing users are preserved without resetting their passwords.

If you want to keep the existing local users, copy `.data/users.json` into the deployed persistent data directory before starting the service.
