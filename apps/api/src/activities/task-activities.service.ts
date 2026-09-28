import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { Paginated, TaskActivityEntry } from '@projectflow/shared';
import { TaskActivityType } from '@projectflow/shared';
import type { PaginationQueryDto } from '../common/dto/pagination.dto';
import { toUserSummary } from '../common/utils/serialize';
import { UsersService } from '../users/users.service';
import { TaskActivity, type TaskActivityDocument } from './schemas/task-activity.schema';

@Injectable()
export class TaskActivitiesService {
  constructor(
    @InjectModel(TaskActivity.name)
    private readonly activityModel: Model<TaskActivityDocument>,
    private readonly usersService: UsersService,
  ) {}

  /** Records an assignee change. Both sides may be null. */
  async recordAssigneeChange(
    taskId: Types.ObjectId,
    actorId: Types.ObjectId,
    from: Types.ObjectId | null,
    to: Types.ObjectId | null,
  ): Promise<void> {
    await this.activityModel.create({
      taskId,
      actorId,
      type: TaskActivityType.TASK_ASSIGNEE_CHANGED,
      fromUserId: from,
      toUserId: to,
    });
  }

  async findByTask(
    taskId: Types.ObjectId,
    query: PaginationQueryDto,
  ): Promise<Paginated<TaskActivityEntry>> {
    const [activities, total] = await Promise.all([
      this.activityModel
        .find({ taskId })
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.pageSize)
        .exec(),
      this.activityModel.countDocuments({ taskId }),
    ]);

    return {
      items: await this.toEntries(activities),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  private async toEntries(activities: TaskActivityDocument[]): Promise<TaskActivityEntry[]> {
    if (activities.length === 0) {
      return [];
    }

    const ids = new Map<string, Types.ObjectId>();
    for (const activity of activities) {
      for (const id of [activity.actorId, activity.fromUserId, activity.toUserId]) {
        if (id) {
          ids.set(id.toString(), id);
        }
      }
    }

    const users = await this.usersService.findManyByIds([...ids.values()]);
    const usersById = new Map(users.map((user) => [user._id.toString(), user]));
    const summary = (id?: Types.ObjectId | null) => {
      const user = id ? usersById.get(id.toString()) : undefined;
      return user ? toUserSummary(user) : null;
    };

    return activities.map((activity) => ({
      id: activity._id.toString(),
      taskId: activity.taskId.toString(),
      type: activity.type as TaskActivityType,
      actor: summary(activity.actorId) ?? DELETED_USER,
      from: summary(activity.fromUserId),
      to: summary(activity.toUserId),
      createdAt: activity.createdAt.toISOString(),
    }));
  }
}

const DELETED_USER = {
  id: '',
  name: 'Unknown user',
  email: '',
  avatarUrl: null,
};