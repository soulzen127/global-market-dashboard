# Internet Deployment

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

If no `.data/users.json` exists on the deployed server, the app creates:

- Username: `admin`
- Password: `Admin@2026!`

The account is forced to change password after first login.

If you want to keep the existing local users, copy `.data/users.json` into the deployed persistent data directory before starting the service.
