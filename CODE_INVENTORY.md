# Code Inventory

## Runtime Files

- `server.ps1`: Local PowerShell HTTP server for prototype execution.
- `server.js`: Node.js HTTP server for hosted deployment with matching auth and approval APIs.
- `index.html`: Main authenticated dashboard shell.
- `app.js`: Frontend dashboard, asset views, groups, reports, audit UI, and user management client logic.
- `styles.css`: Main responsive dashboard styling.
- `login.html`: Login page.
- `login.js`: Login form, bootstrap status check, and login API call.
- `login.css`: Login page styling.

## Deployment Files

- `package.json`: Node runtime metadata and `npm start`.
- `Dockerfile`: Container deployment.
- `.dockerignore`: Docker build exclusions.
- `render.yaml`: Render service configuration.
- `railway.json`: Railway deployment configuration.
- `Procfile`: Procfile-compatible platform start command.
- `.env.example`: Environment variable sample.
- `DEPLOYMENT.md`: English deployment instructions.
- `DEPLOYMENT-ZH.md`: Chinese deployment instructions.
- `global-market-dashboard-deploy.zip`: Generated deployment package.

## Data Files

- `.data/users.json`: Local user account store. This folder is ignored by Git and should not be published as source.
- `.data/permissions.json`: Local operation permission settings.
- `.data/account-applications.json`: Local pending/approved/rejected account applications.
- `.data/mail-outbox.json`: Local notification outbox for Supervisor review emails.

## Security Notes

- Passwords are stored as PBKDF2 hashes with random salt.
- Login sessions are cookie based.
- Hosted production should use HTTPS and a persistent database.
- Do not commit `.data/users.json` to a public repository.
