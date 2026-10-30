# Environment and local development

## Tools

For frontend-only exploration, use `npx pnpm@10.26.1 dev:mock` and open http://localhost:5173. Only Node/pnpm is required. This explicit Vite mode intercepts `/api` fetches in the browser and uses localStorage; it disables the backend SSE connection. The normal `dev` command still uses Spring. The demo banner has a reset button.

- Java JDK 17+ (Java 21 in Docker); no global Maven required with the wrapper.
- Node.js 24 and pnpm 10.26.1 (`npx pnpm@10.26.1 ...` works without a global install).
- Docker with Compose for PostgreSQL and optional API containers.

## Variables

Copy [`.env.example`](../.env.example) to `.env` to override Compose credentials. Defaults run without copying it. Native Java does not automatically load `.env`: set variables in your shell or IDE.

| Variable | Default | Used by |
|---|---|---|
| DB_URL | jdbc:postgresql://localhost:5432/pantrypal | Native Spring |
| DB_USER | pantrypal | Spring / Compose |
| DB_PASSWORD | pantrypal | Spring / Compose |
| API_PORT | 8080 | Native Spring |
| EXPIRY_CHECK_MS | 60000 | Native Spring scheduler |
| PORT | 5173 | Vite |
| BASE_PATH | / | Vite |
| API_TARGET | http://localhost:8080 | Vite proxy |

Vite reads shell variables in its configuration. Set overrides in the shell that starts Vite. `/api` requests, including SSE, are proxied to Spring; direct cross-origin browser access is not needed.

Windows native example, using separate terminals:

```powershell
docker compose up -d db
cd backend
.\mvnw.cmd spring-boot:run
```

```powershell
npx pnpm@10.26.1 install
npx pnpm@10.26.1 dev
```

## Troubleshooting

- Port 5432 occupied: stop the other database or change the Compose host mapping and native DB_URL together.
- Flyway complains about non-empty schema: use a fresh `pantrypal` database; do not baseline the former schema blindly.
- Maven wrapper fails to download: check network access to Maven Central and JAVA_HOME/JDK configuration.
- Windows wrapper requires JAVA_HOME, even if java is already on PATH. For this machine: `$env:JAVA_HOME = 'C:/Program Files/Java/jdk-17'` (use your actual JDK location on another machine).
- Windows Vite native binary missing: reinstall with the current lockfile; this repository now permits Windows native optional dependencies.
- No alerts: add a pantry item with quantity zero or an expiry within seven days. The SSE stream is `/api/notifications/stream`; suggestions are the recoverable alert snapshot.
- Browser notifications require explicit permission. In-app bell alerts work without it.

Prototype limits: shared household data without accounts; Spring events and SSE are process-local and not durable. Reconnects and polling recover current stock alerts; purchase events are cache refresh signals, not a historical notification inbox.
