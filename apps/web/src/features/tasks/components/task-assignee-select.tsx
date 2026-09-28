'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { ProjectMemberEntry, UserSummary } from '@projectflow/shared';
import { Avatar } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCurrentUser } from '@/features/auth/hooks';
import { useProjectMembers } from '@/features/projects/hooks';
import { useUpdateTaskAssignee } from '../hooks';

const UNASSIGNED = '__unassigned__';
/** Only show the search box once the list is long enough to need it. */
const SEARCH_THRESHOLD = 8;

interface TaskAssigneeSelectProps {
  taskId: string;
  projectId: string;
  assignee: UserSummary | null;
}

export function TaskAssigneeSelect({ taskId, projectId, assignee }: TaskAssigneeSelectProps) {
  const [search, setSearch] = useState('');
  const { data: currentUser } = useCurrentUser();
  const { data: members, isPending, isError } = useProjectMembers(projectId);
  const updateAssignee = useUpdateTaskAssignee(taskId, projectId);

  const visible = useMemo(() => filterMembers(members ?? [], search), [members, search]);

  if (isPending) {
    return <Skeleton className="h-8 w-full" />;
  }

  if (isError) {
    return <p className="text-[13px] text-danger">Could not load project members.</p>;
  }

  if (members.length === 0) {
    return <p className="text-[13px] italic text-subtle-foreground">No project members yet.</p>;
  }

  return (
    <Select
      value={assignee?.id ?? UNASSIGNED}
      disabled={updateAssignee.isPending || !currentUser}
      onValueChange={(value) =>
        updateAssignee.mutate(value === UNASSIGNED ? null : value, {
          onError: (error) => toast.error(error.message),
        })
      }
      onOpenChange={(open) => {
        if (!open) {
          setSearch('');
        }
      }}
    >
      <SelectTrigger aria-label="Task assignee">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {members.length >= SEARCH_THRESHOLD ? (
          <div className="p-1">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="Search members"
              aria-label="Search project members"
              className="h-7 text-[12px]"
            />
          </div>
        ) : null}

        <SelectItem value={UNASSIGNED}>
          <span className="text-subtle-foreground">Unassigned</span>
        </SelectItem>

        {visible.map((member) => (
          <SelectItem key={member.user.id} value={member.user.id}>
            <span className="flex items-center gap-2">
              <Avatar user={member.user} size="sm" />
              <span className="truncate">{member.user.name}</span>
            </span>
          </SelectItem>
        ))}

        {visible.length === 0 ? (
          <p className="px-2 py-1.5 text-[12px] text-subtle-foreground">No members match.</p>
        ) : null}
      </SelectContent>
    </Select>
  );
}

function filterMembers(members: ProjectMemberEntry[], search: string): ProjectMemberEntry[] {
  const term = search.trim().toLowerCase();
  if (!term) {
    return members;
  }
  return members.filter(
    (member) =>
      member.user.name.toLowerCase().includes(term) ||
      member.user.email.toLowerCase().includes(term),
  );
}