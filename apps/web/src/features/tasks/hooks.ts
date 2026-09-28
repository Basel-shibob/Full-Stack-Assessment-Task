'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Paginated,
  TaskDetail,
  TaskStatus,
  TaskSummary,
  TaskActivityEntry,
} from '@projectflow/shared';
import { queryKeys } from '@/lib/query-keys';
import {
  createTask,
  type CreateTaskPayload,
  fetchProjectTasks,
  fetchTask,
  updateTaskStatus,
  fetchTaskActivity,
  updateTaskAssignee,
} from './api';

export function useProjectTasks(projectId: string) {
  return useQuery<Paginated<TaskSummary>>({
    queryKey: queryKeys.projectTasks(projectId),
    queryFn: () => fetchProjectTasks(projectId),
    enabled: projectId.length > 0,
  });
}

export function useTask(taskId: string) {
  return useQuery<TaskDetail>({
    queryKey: queryKeys.task(taskId),
    queryFn: () => fetchTask(taskId),
    enabled: taskId.length > 0,
  });
}

export function useCreateTask(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation<TaskDetail, Error, CreateTaskPayload>({
    mutationFn: (payload) => createTask(projectId, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
      ]);
    },
  });
}

export function useUpdateTaskStatus(taskId: string, projectId: string) {
  const queryClient = useQueryClient();

  return useMutation<TaskDetail, Error, TaskStatus>({
    mutationFn: (status) => updateTaskStatus(taskId, status),
    onSuccess: async (task) => {
      queryClient.setQueryData(queryKeys.task(taskId), task);
      await queryClient.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) });
    },
  });
}

export function useTaskActivity(taskId: string) {
  return useQuery<Paginated<TaskActivityEntry>>({
    queryKey: queryKeys.taskActivity(taskId),
    queryFn: () => fetchTaskActivity(taskId),
    enabled: taskId.length > 0,
  });
}

export function useUpdateTaskAssignee(taskId: string, projectId: string) {
  const queryClient = useQueryClient();

  return useMutation<TaskDetail, Error, string | null, { previous?: TaskDetail }>({
    mutationFn: (assigneeId) => updateTaskAssignee(taskId, assigneeId),

    onMutate: async (assigneeId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.task(taskId) });
      const previous = queryClient.getQueryData<TaskDetail>(queryKeys.task(taskId));

      if (previous) {
        queryClient.setQueryData<TaskDetail>(queryKeys.task(taskId), {
          ...previous,
          assignee: assigneeId === null ? null : (previous.assignee ?? null),
        });
      }

      return { previous };
    },

    onError: (_error, _assigneeId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.task(taskId), context.previous);
      }
    },

    onSuccess: (task) => {
      queryClient.setQueryData(queryKeys.task(taskId), task);
    },

    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.taskActivity(taskId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) }),
      ]);
    },
  });
}
