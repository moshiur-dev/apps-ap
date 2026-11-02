# Canopy API

Backend for **Canopy**, a forest-themed ClickUp-style project manager.
NestJS 11 · Prisma 6.19 · MongoDB Atlas · JWT auth.

The frontend lives in its own repo (`apps-web`) and talks to this API over HTTP.

## Features
- Register / login (bcrypt password hashes, 7-day JWT)
- Workspaces → Spaces → Folders → Lists → Tasks → Subtasks
- Tasks: status, priority, assignee, start/due date, estimate, tags, comments with `@Name` mentions
- Roles enforced on every route: **Owner, Admin, Member, Guest**
- Email invites: single-use links, valid 7 days; only a hash of the token is stored
- Inbox notifications, activity audit log, workspace search

## Roles

| Permission                      | Owner | Admin | Member | Guest |
|---------------------------------|:-----:|:-----:|:------:|:-----:|
| View spaces, lists & tasks      | ✓ | ✓ | ✓ | ✓ |
| Comment on tasks                | ✓ | ✓ | ✓ | ✓ |
| Create / edit / delete tasks    | ✓ | ✓ | ✓ |   |
| Create folders & lists          | ✓ | ✓ | ✓ |   |
| Create & delete spaces          | ✓ | ✓ |   |   |
| Delete folders & lists          | ✓ | ✓ |   |   |
| Invite & remove members         | ✓ | ✓ |   |   |
| Make or remove admins           | ✓ |   |   |   |
| Delete workspace                | ✓ |   |   |   |

Rules live in `src/workspaces/access.service.ts`.

## Setup

```bash
npm install
cp .env.example .env      # then fill it in
npx prisma generate
npx prisma db push        # creates collections & indexes; re-run after schema changes
npm run start:dev         # http://localhost:4000/api
```

Health check: `GET /api/health/db` → `{"status":"ok","database":"connected"}`

### Environment variables (`.env`)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Atlas connection string, database name `clickup_clone`. URL-encode special characters in the password. |
| `JWT_SECRET` | yes | Long random string |
| `PORT` | no | Default `4000` |
| `WEB_ORIGIN` | yes | Frontend URL(s) allowed by CORS, comma separated |
| `WEB_URL` | no | Base URL used in invite links (defaults to the first `WEB_ORIGIN`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | no | Invite emails. Without them, the API returns the invite link so it can be copied and shared by hand. |

Gmail: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, and a 16-character Google **App password**.

> Windows: if `npx prisma generate` fails with `EPERM ... query_engine-windows.dll.node`,
> stop the running API first (Ctrl+C).

## API overview (all under `/api`)

| Area | Routes |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` |
| Workspaces | `GET/POST /workspaces`, `PATCH/DELETE /workspaces/:id`, `GET /workspaces/:id/search?q=` |
| Members | `GET /workspaces/:id/members`, `PATCH/DELETE /workspaces/:id/members/:userId` |
| Invites | `GET/POST /workspaces/:id/invites`, `POST /invites/:id/resend`, `DELETE /invites/:id`, `GET /invites/token/:token`, `POST /invites/token/:token/accept` |
| Structure | `POST /workspaces/:id/spaces`, `PATCH/DELETE /spaces/:id`, `POST /spaces/:id/folders`, `PATCH/DELETE /folders/:id`, `POST /spaces/:id/lists`, `PATCH/DELETE /lists/:id` |
| Tasks | `GET/POST /lists/:id/tasks`, `GET /workspaces/:id/tasks`, `GET/PATCH/DELETE /tasks/:id`, `POST /tasks/:id/comments` |
| Inbox & log | `GET /notifications`, `POST /notifications/read-all`, `POST /notifications/:id/read`, `GET /workspaces/:id/activity` |

## Deploying
Host on a Node platform (Render, Railway, Fly.io…). Run `npm run build` then
`npm run start:prod`. Set the variables above, set `WEB_ORIGIN`/`WEB_URL` to your
frontend URL, and allow the host's IP in Atlas **Network Access**.
