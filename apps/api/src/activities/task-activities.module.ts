import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { TaskActivity, TaskActivitySchema } from './schemas/task-activity.schema';
import { TaskActivitiesService } from './task-activities.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: TaskActivity.name, schema: TaskActivitySchema }]),
    UsersModule,
  ],
  providers: [TaskActivitiesService],
  exports: [TaskActivitiesService, MongooseModule],
})
export class TaskActivitiesModule {}