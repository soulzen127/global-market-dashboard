# Global Market Radar PRD

## Product Goal

Global Market Radar is a web dashboard for monitoring global investment targets, including Taiwan stocks, US stocks, bonds, commodities, and precious metals. It supports authenticated access, custom watch groups, trend reporting, asset detail review, annotations, and system audit report queries.

## Target Users

- Individual investors who need a unified view of multiple asset classes.
- Administrators who manage user accounts and system access.
- Analysts who review historical price movement, market notes, and report exports.

## Core User Flows

1. User signs in with an account and password.
2. User views the dashboard for market overview and watch groups.
3. User creates custom groups and adds investment targets.
4. User opens an individual asset detail view to review trend history, zoom in/out, inspect data points, and add notes.
5. User reviews related market news when available, or adds manual annotations.
6. User queries system audit records by keyword, operation type, and date range.
7. Admin manages users, enables/disables accounts, resets passwords, and deletes accounts except the current account.

## Functional Requirements

- Authentication with login, logout, session validation, and password change.
- L1 Supervisor and L2 User roles.
- Permanent highest privilege Supervisor account: `soulzen127@gmail.com`.
- Account application flow where new requests remain pending until a Supervisor approves or rejects them.
- Supervisor notification outbox for account application review.
- Operation permission settings so a Supervisor can assign each feature to L1-only or L2-and-above access.
- Email-style usernames and legacy username support.
- Watchlist/group management with unlimited custom group names.
- Combined group monitoring table for cross-asset comparison.
- Asset detail chart with zoom controls, selected point details, related news, and manual notes.
- Trend report with scenario-style analysis.
- Multi-level alert monitoring with unlimited alert levels such as `Level-01`, `Level-02`, and `Level-03`.
- System audit report query and CSV export.
- Responsive layout with collapsible left navigation and right market information rail.
- Local PowerShell server for prototype execution.
- Node.js server, Dockerfile, Render, Railway, and Procfile for long-term deployment.

## Non-Functional Requirements

- Protected routes and API authentication checks.
- PBKDF2 password hashing with per-user salt.
- Login failure rate limiting.
- Persistent user data under `.data/users.json` locally or `DATA_ROOT/users.json` in hosted deployments.
- No secrets committed to source files.
- Browser access over localhost, LAN, or hosted HTTPS.

## Current Deployment Targets

- Local: `server.ps1` on port `8080`.
- Hosted package: `server.js` with `npm start`.
- Lovable hosted app: `https://global-market-lens-88.lovable.app`.
- Deployment package: `global-market-dashboard-deploy.zip`.

## Known External Dependencies

- Live market data and live news APIs are not currently connected.
- Current app uses built-in/mock market data structures until external API credentials are provided.
- Cloudflare quick tunnel is not suitable for this environment because outbound tunnel edge connectivity has previously failed.
