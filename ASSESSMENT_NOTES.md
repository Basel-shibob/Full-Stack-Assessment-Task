# Assessment Notes

## The system as I found it

### Shape

A pnpm/Turborepo monorepo with two applications and one shared package:

```
apps/api     NestJS 11 + Mongoose 8
apps/web     Next.js 16 App Router + React 19
packages/shared   enums, constants, API response types
```

`packages/shared` is the contract between the two apps. `TaskSummary`,
`ProjectRole`, `Paginated<T>` are defined once and imported by both sides, so a
change to a response shape is a compile error in the frontend rather than a
runtime surprise. This is the most valuable structural decision in the
repository and I extended it rather than working around it — `assignee` was
added to `TaskSummary` and `TaskActivityEntry` was added alongside it.

### Where business logic lives

Every API module follows the same three layers:

```
controller  →  service  →  Mongoose model
     ↑
    DTO validates at the boundary
```

Controllers are deliberately thin: they convert string route params to
`ObjectId` via `toObjectId` and delegate. Nothing decides anything in a
controller. Services hold the rules. DTOs with `class-validator` reject
malformed input before a service ever sees it.

I kept to this. `TasksController.updateAssignee` is four lines; the rules live
in `TasksService.updateAssignee`.

### Frontend ↔ backend

One direction only, over HTTP with a bearer token.

- `lib/api-client.ts` owns the base URL, the `Authorization` header and error
  parsing. It converts any non-2xx into an `ApiError` carrying `statusCode`, so
  callers never touch `fetch` or `response.ok`.
- `features/*/api.ts` wraps each endpoint in a typed function.
- `features/*/hooks.ts` wraps those in TanStack Query hooks.
- Components consume hooks. They do not know a network exists.

Server state belongs entirely to TanStack Query; React state holds only local
UI concerns such as the assignee search box. Query keys live in one registry,
`lib/query-keys.ts`, which is what makes invalidation predictable — after an
assignment succeeds I invalidate `taskActivity` and `projectTasks` by key
rather than guessing at strings.

Components are server components by default; `'use client'` appears only where
hooks or interactivity require it.

### Authentication and authorization

These are two separate mechanisms, and the distinction matters — the production
bug lived precisely in the gap between them.

**Authentication** is a JWT bearer token. `JwtAuthGuard` is registered
globally, so every route is closed unless it opts out with `@Public()`. This
default-deny posture is right.

**Authorization** is `ProjectAccessService`, which answers "may this user touch
this project?" in one place. Access comes from either an elevated organization
role (`OWNER`/`ADMIN`, granting access to every project in the organization) or
an explicit project membership row. `assertCanView` gates reads;
`assertCanManage` gates configuration.

The weakness is that this is a *convention*, not a *guarantee*. The guard
enforces authentication structurally — you cannot forget it. Authorization
depends on each service method remembering to call the right assertion.
`updateStatus` forgot, and nothing caught it. See `BUG_REPORT.md`.

### Entity relationships

```
User
Organization ── OrganizationMember ── User   (OWNER | ADMIN | MEMBER)
Organization ── Project
Project      ── ProjectMember      ── User   (PROJECT_MANAGER | MEMBER)
Project      ── Task ── Comment
                  └──── TaskActivity        (added)
```

Membership lives in its own collection rather than as an array on the parent
document, with a unique compound index on the two foreign keys. That choice
pays off directly in this feature: checking whether a candidate assignee
belongs to a project is one indexed lookup (`ProjectMembersService.findRole`)
rather than loading a project and scanning an array.

Tasks are numbered per project and carry a human-readable key (`ENG-1`).

---

## Risks and weaknesses

Five things I noticed. Two I fixed; three I deliberately did not.

### 1. Authorization is a convention, not a structural guarantee

**What.** `ProjectAccessService` centralizes the *decision*, but nothing
enforces that a mutating method actually asks it. `updateStatus` shipped
without an access check and no test, type or lint rule noticed.

**Why it matters.** This is the bug class, not the bug. Fixing one method does
not stop the next one. Any new task-mutating endpoint can reintroduce it, and
the failure is silent — the endpoint works, it just works for the wrong people.

**Fixed now**, for the one method. The structural guard is not — see below.

### 2. No rate limiting on authentication endpoints

**What.** `POST /auth/login` accepts unlimited attempts from one client. There
is no lockout, no backoff, no throttle anywhere in the application.

**Why it matters.** Passwords are bcrypt-hashed, which protects them at rest,
but nothing slows an online guessing attack. Given the seeded convention of
`Password123!`, a list of a few thousand common passwords against a known email
would very likely succeed. `POST /auth/register` is equally open to abuse.

**Later, but soon.** `@nestjs/throttler` on the auth controller is under an
hour of work. I left it out because it is outside the requested scope and the
brief explicitly values prioritization over breadth — but I would not ship this
service publicly without it. I have used `express-rate-limit` for exactly this
in my own project, so this is a gap I recognized rather than guessed at.

### 3. Offset pagination throughout

**What.** Every paginated query uses `skip`/`limit` plus a `countDocuments` for
the total. I followed the convention for `GET /tasks/:taskId/activity` rather
than introducing a second style.

**Why it matters.** `skip(n)` makes MongoDB walk and discard `n` documents, so
cost grows linearly with page depth. The parallel `countDocuments` scans the
whole matching set on every request. At current data volumes this is invisible;
on the activity collection at scale it will be the first thing to hurt.

**Later, deliberately.** Changing it now would mean either a second pagination
style in one codebase, or rewriting four existing endpoints — a
`Major architectural rewrite` the brief asks me not to attempt. The migration
path is in the scaling section below.

### 4. Task deletion orphans its activity rows

**What.** `TasksService.remove` deletes the task and its comments. It does not
delete its `TaskActivity` rows. This is a gap I introduced.

**Why it matters.** Rows accumulate for tasks that no longer exist. They are
unreachable through the API (the endpoint resolves the task first, so a deleted
task returns 404), so this is storage waste rather than a correctness or
disclosure problem.

**Later.** The honest fix is not a one-line delete — it is deciding whether an
audit trail *should* survive the thing it audits. For a real audit log the
answer is often yes, with a retention policy rather than a cascade. That is a
product decision, not a code decision, and I would rather leave a documented
gap than guess at it under time pressure. Noted again under
*If I Had Two More Days*.

### 5. `ProjectAccessService.resolve` runs three queries per request

**What.** Every authorized call loads the project, the organization membership
and the project membership. A task mutation therefore costs four round trips
before any work happens.

**Why it matters.** It is not wrong, just repetitive — the same three documents
are fetched again and again within a single user's session.

**Later, and probably never.** These are all indexed single-document lookups.
Caching would add invalidation complexity for a problem that has not been
measured. I mention it because I noticed it, not because I think it should
change. "It runs three queries" is not a reason to act; "it is slow under a
measured load" would be.

---

## What I built

### Assignment

`assigneeId` is a nullable `ObjectId` on `Task`, deliberately parallel to
`createdBy` and deliberately separate from it. Creation and ownership are
different facts about a task and conflating them would lose information.

I adapted rather than transplanted: no new join collection, no generic
"assignment" entity, no status/priority changes. One field on the existing
document.

`PATCH /tasks/:taskId/assignee` is a dedicated endpoint rather than another
optional key on `PATCH /tasks/:taskId`, because the permission rules differ.
The generic update allows the task creator or a manager; assignment allows a
manager or the user themselves. Folding two different permission models into
one method produces a function that is hard to read and harder to test. The
repository already establishes this pattern with `PATCH /tasks/:taskId/status`.

The rules, enforced in the service:

| Request | Who may do it |
| --- | --- |
| Assign yourself | Any project member |
| Assign another member | `OWNER`, `ADMIN`, `PROJECT_MANAGER` |
| Unassign | `OWNER`, `ADMIN`, `PROJECT_MANAGER`, or the current assignee |
| Assign a non-member | Nobody — `403` |

The membership check is a separate lookup against `project_members`, not an
inference from the caller's own access. A manager has access to every project
in their organization; that says nothing about whether the *assignee* belongs
to the project.

### Activity history

A separate `task_activities` collection, indexed on `{ taskId: 1, createdAt: -1 }`
to match the read pattern exactly: filter by task, sort newest first.

I stored `fromUserId` and `toUserId` as explicit nullable fields rather than a
free-form `metadata` object. All three transitions the brief requires are then
the same shape:

| Transition | `from` | `to` |
| --- | --- | --- |
| Unassigned → assigned | `null` | user |
| Assigned → different user | user | user |
| Assigned → unassigned | user | `null` |

The brief's example used `metadata: { from, to }`. I diverged because typed
nullable fields give TypeScript something to check, keep the rendering logic a
simple three-branch decision, and remain indexable if activity ever needs to be
queried by participant. The cost is that a future activity type with a
different payload will need its own columns or a `metadata` escape hatch — at
which point adding one is easy, and I would rather not carry an untyped bag of
keys for a single event type today.

Writes are skipped when the assignee did not actually change, so clicking the
same name twice does not pollute the timeline.

**No N+1.** `toEntries` collects every actor, previous and next user id across
the whole page into a `Map`, issues one `$in` query, and resolves from memory.
One page of activity costs two queries total regardless of row count. The same
approach extends `toSummaries` for task assignees.

### Frontend

The assignee selector reuses the existing Radix `Select`, `Avatar` and
`Skeleton` primitives so it is visually indistinguishable from the status
selector beside it. Loading renders a skeleton, error renders the existing
error treatment, an empty member list says so, and the control is disabled
while a mutation is in flight. Search appears only once a project has eight or
more members — a search box over four names is noise.

Assignment uses an optimistic update with rollback: `onMutate` cancels
in-flight queries and snapshots the current task, `onError` restores the
snapshot, `onSuccess` writes the server's response, `onSettled` invalidates the
activity and board queries. The interaction feels instant and a rejected
permission still leaves the UI truthful — which is exactly what happens when a
plain member tries to assign someone else.

The timeline renders sentences, not records: *"Magd Ali changed the assignee
from Ahmed Hassan to themselves"*, with relative timestamps. "themselves"
replaces a name when the actor and the subject are the same person, because the
alternative reads as a stranger's note about a third party.

---

## Code Review

Reviewing the following as a pull request:

```ts
async assignTask(taskId: string, assigneeId: string, userId: string) {
  const task = await this.taskModel.findById(taskId);
  if (!task) { throw new NotFoundException(); }

  const user = await this.userModel.findById(assigneeId);
  if (!user) { throw new NotFoundException(); }

  task.assignee = user._id;
  await task.save();
  return task;
}
```

I would not merge this. The comments below are ordered by severity.

### Blocking

**1. No authorization whatsoever.** `userId` is accepted and never used. Any
authenticated caller can assign any task in any project. This is the same
defect as the production bug in `BUG_REPORT.md`, reintroduced in a new method —
which is the strongest evidence that the codebase needs a structural guard and
not just another careful reviewer. The method must call
`projectAccessService.assertCanView(task.projectId, userId)` before it mutates
anything.

**2. No project membership check on the assignee.** `findById` proves the user
*exists*; the business rule is that they belong to *this project*. As written,
a user from an unrelated organization can be assigned. The existence check is
not a weaker version of the membership check — it answers a different question,
and membership implies existence anyway. One lookup against `project_members`
replaces this one.

**3. The role rules are absent.** The requirement distinguishes a member
assigning themselves from a manager assigning someone else. Neither case is
expressed. The method needs `canManage(access) || assigneeId === userId`.

**4. Unassignment is impossible.** `assigneeId: string` cannot express "remove
the assignee", and `task.assignee = user._id` has no path to `null`. A third of
the specified behaviour cannot be reached through this signature. The parameter
needs to be `string | null` and the flow needs to branch on it.

**5. No activity record.** Required by the specification. It also has to be
written *after* the save succeeds, and skipped when the value did not change —
neither of which the current structure has a place for.

### Significant

**6. `throw new NotFoundException()` twice, with no message.** A caller
receives `404` and cannot tell whether the task or the user was not found. The
repository's error filter produces a `message` field specifically so clients can
say something useful; this method returns an empty one. The second case is
arguably not a 404 at all — the *task* was found; the *request* named an invalid
assignee, which is a 4xx about the input, not about the resource.

**7. Returning the raw Mongoose document.** Every other read path funnels
through `toDetail`/`toSummaries`, which project documents down to
`UserSummary`/`TaskDetail`. Returning `task` directly leaks `__v`, raw
`ObjectId`s and any field later added to the schema — including sensitive ones,
by default, forever. This is how a password hash eventually ends up in an API
response: not by someone exposing it, but by someone adding a field to a schema
whose documents are already being returned wholesale. It also means this
endpoint's response shape differs from every other task endpoint, which the
frontend's shared types will not tolerate.

**8. `String` ids with no validation.** The rest of the codebase converts at the
controller boundary with `toObjectId(value, 'task id')`, which produces a clean
`400` for a malformed id. Here a malformed id reaches Mongoose and surfaces as a
`CastError` — a 500 unless the filter catches it. The service should take
`Types.ObjectId`.

### Minor

**9. Two sequential round trips that do not depend on each other.** The task and
user lookups could be a `Promise.all`. Marginal at this size, and I would not
block on it — but once the authorization and membership lookups are added, the
ordering question becomes real: reject before reading, and parallelize what
remains.

**10. Naming.** `assignTask` sets an assignee; `updateAssignee` says what it
does and sits naturally beside `updateStatus`.

### What I would say to the author

The skeleton is right — service method, guard clauses, `NotFoundException` from
the framework's vocabulary. What is missing is that this method sits inside a
system that already answers most of these questions. `ProjectAccessService`
exists, `toDetail` exists, `toObjectId` exists, and the neighbouring
`updateStatus` demonstrates the shape. The fix is not to write more code; it is
to use the code that is already there.

I would ask specifically: *what happens when a user outside this project is
passed as the assignee, and what do you want to happen?* That question surfaces
2, 3 and 4 in one conversation.

---

## Scaling the activity system

From ~5,000 users to ~500,000, with task activity becoming one of the largest
datasets in the system.

### The shape of the problem

Activity is append-only, read in one narrow pattern (one task, newest first),
and grows without bound. Roughly: 100× the users, and the current design writes
one row per assignee change. Widening activity to cover status, priority,
comments and description edits — which the product will want — multiplies that
again. Assume hundreds of millions of rows within a year or two.

Nothing about the *access pattern* changes at that size. What changes is that
every inefficiency becomes load-bearing.

### What I would change, in order

**Now, before any growth: the compound index.** `{ taskId: 1, createdAt: -1 }`
is already in place and is what makes the query survive at all. Without it,
every activity read becomes a collection scan and nothing else on this list
matters. It exactly matches filter-then-sort, so MongoDB walks a contiguous
index range and stops at the page size.

**At roughly 10× current volume: cursor pagination.** This is the first thing
that will actually hurt.

`skip(n)` walks and discards `n` documents; `countDocuments` scans the whole
matching set. Both run on every request. Deep pages get slower in proportion to
their depth, and the page boundaries shift if a row is inserted mid-scroll.

The replacement uses the sort key as the cursor: `find({ taskId, createdAt: { $lt: cursor } })`,
which seeks straight into the index. Cost becomes constant per page. The total
count goes away — replaced by a `hasMore` boolean derived from fetching
`pageSize + 1` rows. This is a real product trade-off, not a free win: the UI
can no longer say "1 of 40 pages". For an activity feed, which people scroll
rather than paginate, that is the right trade. For the task board, which shows
counts, it is not — which is why I would migrate this endpoint and leave the
others alone.

I would do this when p95 latency on the endpoint starts tracking page depth,
which is measurable before it is noticeable.

**When writes become the bottleneck: make activity asynchronous.** Today the
activity insert is awaited inside the request. It is one small indexed insert,
so this is fine now, and it has a real benefit: the write either succeeds or
the caller finds out.

At high write volume I would move it behind a queue — the request publishes an
event and returns; a worker persists it. The gain is that a slow or degraded
activity collection stops slowing down assignment. The cost is real and worth
stating plainly: the activity log becomes eventually consistent, so a user can
assign a task and not see the entry for a moment, and a lost message means a
lost audit row. That trade is acceptable for a UI timeline. It is *not*
acceptable if activity is ever repurposed as a compliance audit trail — and
"we'll use the activity log for audit" is exactly the kind of requirement that
arrives later and quietly invalidates the decision. I would want that settled
before moving the write off the request path, not after.

I would reach for whatever queue the organization already runs. Introducing
Kafka for this would be adding operational surface to solve a problem a simple
job queue handles.

**When storage cost becomes visible: retention and archiving.** Activity is
read almost exclusively within days of being written, and essentially never
after a task closes. A TTL index on `createdAt` is the cheapest possible
implementation, but it *deletes* — so it is only correct once the product has
explicitly decided that activity older than N months is disposable.

If the answer is "we must keep it but rarely read it", archiving to cold
storage and keeping a recent window hot is the better shape. Either way this is
a product decision that I would surface rather than make. It also resolves the
orphaned-rows gap noted above, which is the same question asked about a
different axis.

**If and only if reads become the bottleneck: caching.** I have put this last
deliberately. An indexed, cursor-paginated query returning 50 rows is already
fast, and a cache on an append-only feed buys little while adding invalidation
logic that can serve stale history. If profiling showed otherwise, a short TTL
on the first page of very hot tasks would be the narrowest useful intervention.

### What I would not do

**Real-time updates.** Technically straightforward — the activity write is
already a natural event, so publishing to a socket channel is a small addition.
But this is a feature request, not a scaling measure, and it makes the system
*harder* to scale by adding persistent connections. If the product wants it,
build it as a feature with its own justification.

**Sharding, read replicas, separate services.** Each solves a problem this
system does not have and will not have at 500,000 users with this access
pattern. Introducing them early is how a codebase acquires operational
complexity it never needed.

### Observability, which comes first

Everything above is conditional on measurement, so this is not the last item —
it is the prerequisite. Before any of these changes I would want p50/p95/p99
latency on the activity endpoint, the row count and growth rate of
`task_activities`, and slow-query logging on the collection.

The failure mode I most want to avoid is optimizing the wrong layer. Without
numbers, the list above is a guess.

---

## If I Had Two More Days

Ordered by what I would actually pick up first.

**1. A structural guard against the authorization bug class.** The single
highest-value item. Fixing `updateStatus` fixed one method; the pattern that
allowed it is untouched. Two candidate approaches: an e2e test that asserts
every task-mutating route rejects a non-member, or a guard that resolves
project access declaratively from the route so that a method *cannot* forget.
I would start with the test because it is cheap and proves the problem, then
decide whether the guard earns its complexity. First, because it is the only
item here that prevents a recurrence of a real production incident.

**2. Rate limiting on `/auth/*`.** An hour with `@nestjs/throttler`. Second
because it is the largest remaining security gap and the smallest fix.

**3. Frontend tests for the assignee selector.** The backend rules are covered;
the UI logic that decides what a user may attempt is not. The optimistic-update
rollback in particular is the kind of code that breaks silently and stays
broken.

**4. Widen activity to status and priority changes.** The schema and the
rendering already generalize — this is a new `type` value, a branch in
`describeActivity`, and calls from `updateStatus` and `update`. I scoped to
assignee because the brief did, and I would rather deliver one event type
correctly than three partially.

**5. Resolve the task-deletion / activity-retention question.** Covered under
risk 4. Two days is enough to ask the question and implement whichever answer
comes back.

**6. Cursor pagination on the activity endpoint.** The right change eventually,
but premature at current volume, and the brief is explicit that adding
technology to look sophisticated is not the goal.

### What I would leave alone entirely

The module structure, the shared-types package, `ProjectAccessService` as the
single authorization decision point, and the TanStack Query patterns. These are
the parts of the codebase that made this feature straightforward to add, and
the highest-value thing I did in four hours was extend them rather than
replace them.
