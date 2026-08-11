# System Review

Review date: 2026-07-08

## Scope

This review covered the local web system in `C:\Users\soulz\Documents\Codex\2026-06-01\web`, the Lovable hosted project status, deployment artifacts, and the availability of GitHub/Notion connector context.

## Checks Completed

- PowerShell server syntax check: passed.
- Local server restart on `0.0.0.0:8080`: passed.
- Login page request: HTTP 200.
- Bootstrap status API: HTTP 200.
- Login test for `soulzen127@gmail.com` with current password: HTTP 200.
- Supervisor permissions API: HTTP 200.
- Account application API: HTTP 202.
- Account application review API: HTTP 200.
- LAN login page request: HTTP 200.
- Lovable public app root request: HTTP 200.
- Lovable CSS/JS asset requests: HTTP 200.
- Deployment zip regenerated.

## Issues Found And Fixed

### User data serialization bug

`server.ps1` used positional `ConvertTo-Json @($Users)`, which can cause PowerShell to serialize account data as a `value` and `Count` wrapper object. This previously made `.data/users.json` unstable.

Fix:

- Updated `Save-Users` to call `ConvertTo-Json -InputObject ([object[]]@($Users))`.
- Kept recursive compatible readers in `server.ps1` and `server.js`.
- Repaired `.data/users.json` back to a normal array of user records.

### Deployment package freshness

The deployment zip did not include the latest `server.ps1` fix.

Fix:

- Regenerated `global-market-dashboard-deploy.zip` with the updated server files and documentation.

### L1/L2 access model and account approval

Added L1 Supervisor and L2 User roles. The `soulzen127@gmail.com` account is enforced as the permanent L1 Supervisor account. New account applications are stored as pending records until a Supervisor approves or rejects them.

### Multi-level alerts

Expanded the alert center so each monitored target can have unlimited alert levels, such as `Level-01`, `Level-02`, and `Level-03`, with severity labels.

## Remaining Risks

- Node.js is not installed on this Windows environment, so `node --check server.js` and local Node server execution could not be verified here.
- The local folder has a `.git` path but Git does not recognize it as a valid repository. No GitHub remote could be identified.
- GitHub connector search did not find a repository matching this project name.
- Live market data/news API integration remains future work.
- Lovable content is deployed and reachable, but its internal implementation cannot be deeply source-reviewed from this local folder unless Lovable exports code or GitHub integration is provided.
- The Lovable public URL is reachable, but the current local code changes are not automatically synchronized into Lovable because the available Lovable tool can inspect/deploy existing hosted project state, not import this local codebase.

## Recommended Next Upgrades

- Create or connect a real GitHub repository for this project.
- Install Node.js locally or add CI on GitHub to run `node --check server.js`.
- Add automated smoke tests for login, protected route redirect, and user management endpoints.
- Move user/session persistence to a managed database for hosted production.
- Add real market/news API adapters behind server-side endpoints.
- Add audit records to server-side persistent storage instead of only browser local storage.
