# AI Usage

## Tools used

Claude, throughout. No other assistant.

## How I used it

Heavily, and across the whole task:

- **Understanding the codebase.** I asked it to walk me through the module
  structure and to trace a single request end to end, rather than reading the
  repository file by file. That gave me the controller → service → model shape
  and the role of `ProjectAccessService` much faster than I would have found
  them alone.
- **Diagnosis.** I asked it to look for the reported production issue and for
  the concurrency problem. It located both.
- **Implementation.** I wrote the code in my own editor, one step at a time,
  with Claude explaining what each change needed to do and reviewing what I
  wrote. Several of the larger blocks — the activity service, the assignee
  selector component, the e2e suite — started as its draft, which I read,
  adjusted and ran.
- **Testing and verification.** I ran `pnpm typecheck` and `pnpm test` after
  every step and fed failures back. This is where the process earned its keep:
  more than one problem surfaced from a failing run rather than from reading.
- **Documentation.** The other markdown files were drafted with Claude from the
  decisions we had already made and the code that already existed.

I did not use it to generate the whole thing in one pass. Each piece was small
enough for me to follow, and I ran everything myself.

## A suggestion I disagreed with

The first real disagreement was about whether the reported bug was a bug at
all.

Claude told me `PATCH /tasks/:taskId/status` had no authorization check. My
reaction was that this was fine — anyone working on a task should be able to
move it across the board, and I said so directly. I thought it was describing
normal product behaviour as a defect.

What changed my mind was a concrete case rather than an argument: the seeded
`outside@example.com` account belongs to no organization and no project at all,
and it could still send that request and get `200 OK`. I had been reading "any
user" as "any member of the project." The code was not checking membership; it
was checking nothing.

The interesting part is that my original instinct was right about the *rule* —
any project member should be able to change a status — and that is exactly why
the fix is `assertCanView` rather than `assertCanManage`. I had briefly written
`assertCanManage`, which would have closed the hole and broken the product for
ordinary members. So the disagreement was worth having: it produced a better
fix than either of my first two positions.

I now treat "this is a bug" from an assistant as a claim to verify against the
actual data, not as a verdict.

## Generated code I had to change

The concurrency test failed on its first run with
`E11000 duplicate key error ... index: projectId_1_number_1`.

The test itself was correct. The code around it was not: the e2e fixtures
insert tasks straight into the collection without advancing
`Project.lastTaskNumber`, so the counter stayed at zero and the first
concurrently created task collided with a fixture task. The same oversight
existed in `database/seed.ts`.

Claude's draft of the test did not account for this, and neither did I when I
added the counter. It only showed up because the unique index I had added was
doing its job — without it, the inconsistency would have passed silently.

I fixed both paths: the fixtures and the seed now maintain `lastTaskNumber`
with `$max` and `$set` respectively. The underlying rule is that every code
path that creates a task must advance the counter, which is now documented in
the README.

Smaller change: I was offered a non-null assertion (`...!`) to satisfy
TypeScript when mapping an assignee, with a note that it would crash if the
user had been deleted. I used a small helper returning `null` instead, which
matches how the codebase already handles a missing task creator.
