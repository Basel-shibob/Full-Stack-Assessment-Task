# ProjectFlow

ProjectFlow is a lightweight project and task tracker for software teams.
Organizations own projects, projects own tasks, and tasks carry a status, a
priority and a discussion thread.

It is a TypeScript monorepo: a NestJS + MongoDB API and a Next.js App Router
frontend, sharing a small package of domain types and enums.

---

## Technology stack

| Area         | Choice                                           |
| ------------ | ------------------------------------------------ |
| Monorepo     | pnpm workspaces + Turborepo                      |
| Language     | TypeScript 5.9                                   |
| API          | NestJS 11, Mongoose 8, MongoDB                   |
| Auth         | JWT bearer tokens, bcrypt password hashing       |
| Web          | Next.js 16 (App Router), React 19                |
| Styling      | Tailwind CSS 4, Radix primitives, Phosphor Icons |
| Server state | TanStack Query 5                                 |
| Forms        | React Hook Form + Zod                            |
| Testing      | Jest, Supertest, mongodb-memory-server           |

---

## Prerequisites

- **Node.js 20.19+** (22 or 24 recommended)
- **pnpm 10+** — `npm install -g pnpm`
- **MongoDB 7+** running locally

On macOS:

```bash
brew tap mongodb/brew
brew install mongodb-community@7.0
brew services start mongodb-community@7.0
```

Any reachable MongoDB works — point `MONGODB_URI` wherever you like.

---

## Installation

```bash
pnpm install
```

## Environment setup

Configuration lives in a single `.env` file at the repository root; both apps
read it.

```bash
cp .env.example .env
```

| Variable              | Purpose                          | Default                                 |
| --------------------- | -------------------------------- | --------------------------------------- |
| `MONGODB_URI`         | MongoDB connection string        | `mongodb://127.0.0.1:27017/projectflow` |
| `JWT_SECRET`          | Signing secret for access tokens | — (required)                            |
| `JWT_EXPIRES_IN`      | Access token lifetime            | `7d`                                    |
| `API_PORT`            | Port the API listens on          | `4732`                                  |
| `WEB_ORIGIN`          | Origin allowed by CORS           | `http://localhost:3742`                 |
| `NEXT_PUBLIC_API_URL` | API base URL used by the browser | `http://localhost:4732`                 |

The API refuses to boot if `MONGODB_URI` or `JWT_SECRET` is missing.

## Database

Make sure MongoDB is running, then load development data:

```bash
pnpm seed
```

The seed is repeatable — it clears the ProjectFlow collections and reinserts a
fresh organization, users, projects, tasks and comments.

## Running the apps

```bash
pnpm dev
```

- Web — <http://localhost:3742>
- API — <http://localhost:4732>

Both apps deliberately avoid the usual 3000/4000 defaults so they do not clash
with other projects. To move the web app, set `WEB_PORT` in your shell and
update `WEB_ORIGIN` in `.env` to match, so CORS keeps working:

```bash
WEB_PORT=3800 pnpm --filter @projectflow/web dev
```

The API port comes from `API_PORT` in `.env`; change `NEXT_PUBLIC_API_URL` to
match if you move it.

Run one at a time if you prefer:

```bash
pnpm --filter @projectflow/api dev
pnpm --filter @projectflow/web dev
```

## From a clean checkout

```bash
pnpm install
cp .env.example .env
pnpm seed
pnpm dev
```

---

## Commands

| Command          | Description                                |
| ---------------- | ------------------------------------------ |
| `pnpm dev`       | Run the API and web app in watch mode      |
| `pnpm build`     | Build every package and app                |
| `pnpm lint`      | ESLint across the workspace                |
| `pnpm typecheck` | TypeScript project-wide, no emit           |
| `pnpm test`      | API test suite (uses an in-memory MongoDB) |
| `pnpm seed`      | Reset and reload development data          |
| `pnpm format`    | Prettier write                             |

`pnpm test` does not need a running MongoDB — it starts a throwaway in-memory
server for the duration of the run. The first run downloads a MongoDB binary
(around 100 MB) and caches it.

---

## Development credentials

Seeded accounts, all sharing the password `Password123!`:

| Name         | Email                 | Access                    |
| ------------ | --------------------- | ------------------------- |
| Ammar Yaser  | `ammar@example.com`   | Organization owner        |
| Sarah Ahmed  | `sarah@example.com`   | Organization admin        |
| Ahmed Hassan | `ahmed@example.com`   | Project manager on `ENG`  |
| Magd Ali     | `magd@example.com`    | Member of `ENG` and `WEB` |
| Outside User | `outside@example.com` | No organization           |

These are local development accounts only.

---

## Architecture

```
projectflow/
├── apps/
│   ├── api/                     NestJS API
│   │   ├── src/
│   │   │   ├── auth/            register / login / current user
│   │   │   ├── users/
│   │   │   ├── organizations/
│   │   │   ├── organization-members/
│   │   │   ├── projects/        projects + ProjectAccessService
│   │   │   ├── project-members/
│   │   │   ├── tasks/
│   │   │   ├── comments/
│   │   │   ├── common/          guards, decorators, filters, shared DTOs
│   │   │   ├── activities/      task activity history
│   │   │   └── database/seed.ts
│   │   └── test/                e2e suites and fixtures
│   │
│   └── web/                     Next.js App Router frontend
│       └── src/
│           ├── app/             routes and layouts
│           ├── components/      design system primitives + app shell
│           ├── features/        auth, projects, tasks, comments
│           ├── lib/             API client, query keys, formatting
│           └── providers/       TanStack Query provider
│
└── packages/
    ├── shared/                  enums, constants, API response types
    ├── eslint-config/           flat ESLint configs
    └── tsconfig/                base TypeScript configs
```

### API layering

Each module follows the same shape: controller → service → Mongoose model, with
DTOs validating input at the boundary. Controllers stay thin; business rules
live in services.

### Domain model

```
User
Organization        ── OrganizationMember ── User      (OWNER | ADMIN | MEMBER)
Organization  ── Project
Project             ── ProjectMember      ── User      (PROJECT_MANAGER | MEMBER)
Project       ── Task ── Comment
                   └──── TaskActivity
```

Membership is stored in its own collection rather than as arrays on the parent
document, so it can be indexed and queried directly. Both membership
collections carry a unique compound index on their two foreign keys.

Tasks are numbered per project and identified by a human-readable key derived
from the project key: `ENG-1`, `ENG-2`, `WEB-1`.

### Authorization

`ProjectAccessService` answers "may this user touch this project?" in one
place. Access comes from either an elevated organization role (`OWNER` or
`ADMIN`, which grants access to every project in the organization) or an
explicit project membership row. `assertCanView` gates reads, `assertCanManage`
gates configuration and membership changes.

Authentication is a JWT bearer token. `JwtAuthGuard` is registered globally;
routes opt out with the `@Public()` decorator.

### API surface

```
POST   /auth/register
POST   /auth/login
GET    /auth/me

GET    /organizations

GET    /projects
POST   /projects
GET    /projects/:projectId
GET    /projects/:projectId/members
POST   /projects/:projectId/members

GET    /projects/:projectId/tasks
POST   /projects/:projectId/tasks
GET    /tasks/:taskId
PATCH  /tasks/:taskId
PATCH  /tasks/:taskId/assignee
PATCH  /tasks/:taskId/status
DELETE /tasks/:taskId
GET    /tasks/:taskId/activity

GET    /tasks/:taskId/comments
POST   /tasks/:taskId/comments
```

Errors share one shape:

```json
{
  "statusCode": 403,
  "message": "You do not have access to this project",
  "error": "Forbidden"
}
```

### Frontend

Routes are thin; the work happens in `features/`. Server state is owned by
TanStack Query — query keys live in `lib/query-keys.ts` so invalidation stays
predictable — and local UI state stays in React. The API client in
`lib/api-client.ts` centralises the base URL, the auth header and error
parsing.

Components are server components by default; `"use client"` is added only where
interactivity or hooks require it.

---

## Technical decisions

Decisions made while adding task assignment and activity history. The reasoning
in full is in `ASSESSMENT_NOTES.md`.

### Assignment lives on the task, not in a join collection

`assigneeId` is a nullable `ObjectId` on `Task`, deliberately separate from
`createdBy`. A task has at most one assignee, so a join collection would add a
lookup and a schema to model a relationship the document already expresses.

### Assignment has its own endpoint

`PATCH /tasks/:taskId/assignee` rather than another optional key on
`PATCH /tasks/:taskId`, because the permission rules differ: the generic update
allows the creator or a manager, while assignment allows a manager or the user
themselves. The repository already separates `PATCH /tasks/:taskId/status` for
the same reason.

### Assignment rules are enforced in the service

| Request               | Who may do it                               |
| --------------------- | ------------------------------------------- |
| Assign yourself       | Any project member                          |
| Assign another member | `OWNER`, `ADMIN`, `PROJECT_MANAGER`         |
| Unassign              | An authorized role, or the current assignee |
| Assign a non-member   | Nobody — `403`                              |

Project membership of the _assignee_ is checked separately from the access of
the _caller_. A manager has access to every project in their organization;
that says nothing about whether the person being assigned belongs to it.

### Activity is a separate collection with typed endpoints

`task_activities`, indexed on `{ taskId: 1, createdAt: -1 }` to match the read
pattern (filter by task, newest first).

Transitions are stored as explicit nullable `fromUserId` / `toUserId` fields
rather than an untyped `metadata` object, so all three cases the feature
requires are the same shape and TypeScript can check them:

| Transition                | `from` | `to`   |
| ------------------------- | ------ | ------ |
| Unassigned → assigned     | `null` | user   |
| Assigned → different user | user   | user   |
| Assigned → unassigned     | user   | `null` |

A row is written only when the assignee actually changes.

Reads resolve every actor, previous and next user for a whole page in one `$in`
query, so a page of activity costs two queries regardless of row count.

### Task numbering is concurrency-safe

`Project.lastTaskNumber` is a monotonic counter reserved with a single atomic
`findOneAndUpdate` + `$inc`. It replaces a `countDocuments` + 1 that could hand
the same number to two concurrent requests.

`{ projectId, number }` carries a **unique index**, so the database rejects a
duplicate even if application code is later rewritten incorrectly.

This relies on single-document atomicity in MongoDB, not on transactions — it
runs on a standalone `mongod` with no replica set. Full reasoning in
`BUG_REPORT.md`.

Any code path that creates tasks outside `TasksService` must advance the
counter. Both `database/seed.ts` and the e2e fixtures do.

### The frontend uses optimistic updates with rollback

Assignment updates the cache in `onMutate`, restores the snapshot in `onError`,
and writes the server's response in `onSuccess`. The interaction feels instant
and a rejected permission still leaves the UI truthful.

### Authorization fix

`PATCH /tasks/:taskId/status` previously performed no access check at all. It
now resolves project access like every other mutation. `assertCanView` rather
than `assertCanManage`, because moving a task across the board is routine work
for any project member. See `BUG_REPORT.md`.

---
