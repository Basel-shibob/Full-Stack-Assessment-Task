'use client';

import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/dist/ssr';
import type { TaskActivityEntry } from '@projectflow/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelativeTime } from '@/lib/format';
import { useTaskActivity } from '../hooks';

export function TaskActivityList({ taskId }: { taskId: string }) {
  const { data, isPending, isError, error } = useTaskActivity(taskId);

  return (
    <section className="space-y-4" aria-label="Activity">
      <h2 className="text-sm font-semibold text-foreground">Activity</h2>

      {isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ) : isError ? (
        <p className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-[13px] text-danger">
          {error.message}
        </p>
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={ClockCounterClockwiseIcon}
          title="No activity yet"
          description="Assignment changes will appear here."
        />
      ) : (
        <ul className="space-y-2">
          {data.items.map((activity) => (
            <li
              key={activity.id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
            >
              <span className="text-[13px] leading-5 text-muted-foreground">
                {describeActivity(activity)}
              </span>
              <span className="text-[12px] text-subtle-foreground">
                {formatRelativeTime(activity.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Turns a raw activity row into a sentence a person can read. */
function describeActivity(activity: TaskActivityEntry): string {
  const actor = activity.actor.name;
  const from = activity.from;
  const to = activity.to;

  if (!from && to) {
    return to.id === activity.actor.id
      ? `${actor} assigned themselves`
      : `${actor} assigned ${to.name}`;
  }

  if (from && !to) {
    return `${actor} removed the assignee`;
  }

  if (from && to) {
    const fromName = from.id === activity.actor.id ? 'themselves' : from.name;
    const toName = to.id === activity.actor.id ? 'themselves' : to.name;
    return `${actor} changed the assignee from ${fromName} to ${toName}`;
  }

  return `${actor} updated the assignee`;
}