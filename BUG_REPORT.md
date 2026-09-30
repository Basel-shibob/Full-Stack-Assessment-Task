# Bug Report

Two defects were investigated. The first is the issue reported by support. The
second was found while reading the task creation path and is documented here
because it corrupts data in the same way — silently.

---

## 1. Unauthorized users can modify tasks in projects they do not belong to

**Status:** Reproduced and fixed.

### Root cause

`TasksService.updateStatus` performed no authorization check at all:

```ts
async updateStatus(taskId: Types.ObjectId, dto: UpdateTaskStatusDto): Promise<TaskDetail> {
  const task = await this.findTaskOrFail(taskId);
  task.status = dto.status;
  await task.save();
  return this.toDetail(task);
}
```

The method never received a `userId`, and `TasksController.updateStatus` never
passed one. Every other method on the service resolves project access before
mutating:

| Method | Access check |
| --- | --- |
| `findOne` | `assertCanView` |
| `update` | `assertCanView` + creator/manager check |
| `remove` | `assertCanManage` |
| `updateStatus` | **none** |

This is an omission in one method rather than a deliberate design decision.
`JwtAuthGuard` is registered globally, so the endpoint did require a valid
token — which is why the gap was not obvious. Authentication was enforced;
authorization was not.

### Impact

Any authenticated user could change the status of any task in the system,
given only its id. That includes a user who belongs to no organization at all
(the seeded `outside@example.com` account). Task ids are exposed in URLs and in
API responses, so they are not a meaningful secret.

Concretely, an attacker could mark another organization's work as `DONE`,
reopen completed tasks, or churn a board's state. Reads stayed protected, so
this is an integrity problem rather than a data-disclosure one.

### Reproduction

1. `pnpm seed`
2. Sign in as `ammar@example.com` and copy any task id from the URL.
3. Sign in as `outside@example.com` — a user in no organization — and take the
   access token.
4. Send:

```
PATCH /tasks/<taskId>/status
Authorization: Bearer <outsider token>
{ "status": "DONE" }
```

Before the fix this returned `200 OK` and the task's status changed. After the
fix it returns `403 Forbidden`.

### Fix

`updateStatus` now takes the acting user and resolves project access before
touching the task, exactly like its neighbours:

```ts
async updateStatus(
  taskId: Types.ObjectId,
  userId: Types.ObjectId,
  dto: UpdateTaskStatusDto,
): Promise<TaskDetail> {
  const task = await this.findTaskOrFail(taskId);
  const { project } = await this.projectAccessService.assertCanView(task.projectId, userId);

  task.status = dto.status;
  await task.save();

  return this.toDetail(task, project);
}
```

The controller passes `@CurrentUser('id')` through.

**Why `assertCanView` and not `assertCanManage`.** Moving a task across the
board is routine work for the whole team, and any project member can already
create tasks and comment on them. Requiring a manager role would have closed
the hole but broken the product for ordinary members. The rule the bug report
implies is membership, not seniority.

The returned `project` is reused by `toDetail`, which saves a redundant lookup.

### Regression prevention

`apps/api/test/task-assignment.e2e.spec.ts`:

> `refuses to let an outsider change the status of another project task`

A user outside the organization sends the same request and must receive `403`.
The test fails against the original code.

Two structural points worth noting beyond the single test:

- The whole class of bug is "a mutation that forgets to ask
  `ProjectAccessService`." Authorization already lives in one place; the fix
  was to use it, not to add a new mechanism.
- A stronger long-term guard would be a check that every task-mutating route
  resolves project access — see `ASSESSMENT_NOTES.md`.

---

## 2. Concurrent task creation can produce duplicate task keys

**Status:** Reproduced and fixed.

### Root cause

`TasksService.create` derived the next task number by counting:

```ts
const taskCount = await this.taskModel.countDocuments({ projectId });
const number = taskCount + 1;
```

The read and the write are two separate round trips. Between them, another
request can read the same count. Both then write the same number, so two tasks
end up as `ENG-6`.

The count is also wrong after any deletion: delete `ENG-2` and the next task
created reuses `ENG-3`, which already exists.

There was no unique index on `{ projectId, number }`, so neither failure mode
produced an error — the duplicates were simply stored.

### Impact

Two tasks in a project share a human-readable key. Anything that refers to a
task by key — a commit message, a standup note, a link a person types by hand —
becomes ambiguous. The damage is permanent once written, and there is no signal
that it happened.

### Reproduction

Five concurrent `POST /projects/:projectId/tasks` requests. Against the
original code the responses contain repeated keys; the test asserts all five
are distinct.

### Fix

The project document now carries a monotonic counter, reserved atomically:

```ts
const project = await this.projectModel.findOneAndUpdate(
  { _id: projectId },
  { $inc: { lastTaskNumber: 1 } },
  { new: true },
);
```

`$inc` is applied by MongoDB inside a single-document update, so concurrent
callers are serialized and each receives a distinct number. There is no gap
between reading and incrementing, because there is no separate read.

A counter that only ever rises also fixes the deletion case: numbers are never
reused.

Access is still checked **before** the increment, so a rejected request does
not consume a number.

### Decisions this depends on

- **Single-document atomicity, not transactions.** `$inc` on one document is
  atomic in MongoDB without a replica set or a session. The solution therefore
  runs on a plain standalone `mongod`, which is what the README asks for.
- **Counter on the project, not a separate `counters` collection.** A dedicated
  collection is the right shape when a system has many independent sequences.
  ProjectFlow has exactly one, and the project document is already loaded on
  this path. A new schema, module and service for a single counter would be
  cost without benefit.
- **Trade-off accepted:** numbers can develop gaps if a create fails after the
  increment. Gaps are harmless; duplicates are not.

### Regression prevention

- `TaskSchema.index({ projectId: 1, number: 1 }, { unique: true })` — the
  database now rejects a duplicate outright. Application code can be rewritten
  later; this constraint survives it.
- `gives concurrently created tasks distinct identifiers` — five parallel
  creations, all keys distinct.

**The index immediately earned its place.** The concurrency test failed on its
first run with `E11000 duplicate key`, because the test fixture inserted tasks
straight into the collection without advancing the counter — the same
oversight existed in `database/seed.ts`. Both now maintain
`lastTaskNumber`. Without the unique index, that inconsistency would have
passed silently and shipped.
