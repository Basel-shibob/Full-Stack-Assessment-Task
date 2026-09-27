/**
 * Development seed. Wipes the ProjectFlow collections and inserts a small,
 * realistic dataset so the app is usable immediately after a fresh checkout.
 */
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import * as bcrypt from 'bcryptjs';
import mongoose, { Types } from 'mongoose';
import { OrganizationRole, ProjectRole, TaskPriority, TaskStatus } from '@projectflow/shared';
import { OrganizationMemberSchema } from '../organization-members/schemas/organization-member.schema';
import { OrganizationSchema } from '../organizations/schemas/organization.schema';
import { ProjectMemberSchema } from '../project-members/schemas/project-member.schema';
import { ProjectSchema } from '../projects/schemas/project.schema';
import { TaskSchema } from '../tasks/schemas/task.schema';
import { CommentSchema } from '../comments/schemas/comment.schema';
import { UserSchema } from '../users/schemas/user.schema';

loadEnv({ path: resolve(__dirname, '../../../../.env'), quiet: true });
loadEnv({ quiet: true });

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/projectflow';
const SEED_PASSWORD = 'Password123!';

const User = mongoose.model('User', UserSchema);
const Organization = mongoose.model('Organization', OrganizationSchema);
const OrganizationMember = mongoose.model('OrganizationMember', OrganizationMemberSchema);
const Project = mongoose.model('Project', ProjectSchema);
const ProjectMember = mongoose.model('ProjectMember', ProjectMemberSchema);
const Task = mongoose.model('Task', TaskSchema);
const Comment = mongoose.model('Comment', CommentSchema);

interface SeedUser {
  name: string;
  email: string;
  organizationRole: OrganizationRole | null;
}

const SEED_USERS: SeedUser[] = [
  { name: 'Ammar Yaser', email: 'ammar@example.com', organizationRole: OrganizationRole.OWNER },
  { name: 'Sarah Ahmed', email: 'sarah@example.com', organizationRole: OrganizationRole.ADMIN },
  { name: 'Ahmed Hassan', email: 'ahmed@example.com', organizationRole: OrganizationRole.MEMBER },
  { name: 'Magd Ali', email: 'magd@example.com', organizationRole: OrganizationRole.MEMBER },
  { name: 'Outside User', email: 'outside@example.com', organizationRole: null },
];

async function seed(): Promise<void> {
  await mongoose.connect(MONGODB_URI);
  console.warn(`Connected to ${MONGODB_URI}`);

  await Promise.all([
    Comment.deleteMany({}),
    Task.deleteMany({}),
    ProjectMember.deleteMany({}),
    Project.deleteMany({}),
    OrganizationMember.deleteMany({}),
    Organization.deleteMany({}),
    User.deleteMany({}),
  ]);

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);
  const users = await User.insertMany(
    SEED_USERS.map((user) => ({
      name: user.name,
      email: user.email,
      passwordHash,
      avatarUrl: null,
    })),
  );

  const userIdByEmail = new Map(users.map((user) => [user.email, user._id as Types.ObjectId]));
  const userId = (email: string): Types.ObjectId => {
    const id = userIdByEmail.get(email);
    if (!id) {
      throw new Error(`Seed user missing: ${email}`);
    }
    return id;
  };

  const ammar = userId('ammar@example.com');
  const sarah = userId('sarah@example.com');
  const ahmed = userId('ahmed@example.com');
  const magd = userId('magd@example.com');

  const organization = await Organization.create({
    name: 'Acme Software',
    slug: 'acme-software',
    ownerId: ammar,
  });

  await OrganizationMember.insertMany(
    SEED_USERS.filter((user) => user.organizationRole !== null).map((user) => ({
      organizationId: organization._id,
      userId: userId(user.email),
      role: user.organizationRole,
    })),
  );

  const [internalPlatform, customerPortal] = await Project.insertMany([
    {
      organizationId: organization._id,
      name: 'Internal Platform',
      key: 'ENG',
      description: 'Core internal tooling used by the engineering and delivery teams.',
      createdBy: ammar,
    },
    {
      organizationId: organization._id,
      name: 'Customer Portal',
      key: 'WEB',
      description: 'Customer-facing portal for account management and billing.',
      createdBy: sarah,
    },
  ]);

  if (!internalPlatform || !customerPortal) {
    throw new Error('Failed to seed projects');
  }

  await ProjectMember.insertMany([
    { projectId: internalPlatform._id, userId: ahmed, role: ProjectRole.PROJECT_MANAGER },
    { projectId: internalPlatform._id, userId: magd, role: ProjectRole.MEMBER },
    { projectId: customerPortal._id, userId: sarah, role: ProjectRole.PROJECT_MANAGER },
    { projectId: customerPortal._id, userId: magd, role: ProjectRole.MEMBER },
  ]);

  const engineeringTasks = [
    {
      number: 1,
      title: 'Implement authentication refresh flow',
      description:
        'Access tokens currently expire without a refresh path, so long sessions log the user out mid-task. Design and implement a refresh flow that keeps sessions alive without weakening token security.',
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.HIGH,
      createdBy: ammar,
    },
    {
      number: 2,
      title: 'Improve project dashboard responsiveness',
      description:
        'The project list reflows badly between 768px and 1024px. Cards overlap and the member avatars wrap onto their own line.',
      status: TaskStatus.TODO,
      priority: TaskPriority.MEDIUM,
      createdBy: sarah,
    },
    {
      number: 3,
      title: 'Add project member search',
      description:
        'Projects with more than twenty members are hard to scan. Add a client-side filter on the members list before we invest in a server-side search endpoint.',
      status: TaskStatus.TODO,
      priority: TaskPriority.LOW,
      createdBy: ahmed,
    },
    {
      number: 4,
      title: 'Fix mobile sidebar behaviour',
      description:
        'On small screens the sidebar drawer stays open after navigating to a task, covering the content underneath.',
      status: TaskStatus.IN_REVIEW,
      priority: TaskPriority.URGENT,
      createdBy: magd,
    },
    {
      number: 5,
      title: 'Improve API error handling',
      description:
        'Validation failures and permission errors reach the client in different shapes. Normalise them behind a single error contract.',
      status: TaskStatus.DONE,
      priority: TaskPriority.MEDIUM,
      createdBy: ammar,
    },
    {
      number: 6,
      title: 'Document local development setup',
      description: 'New joiners need a single page that covers install, seed and run.',
      status: TaskStatus.TODO,
      priority: TaskPriority.LOW,
      createdBy: ahmed,
    },
  ].map((task) => ({
    ...task,
    projectId: internalPlatform._id,
    key: `ENG-${task.number}`,
  }));

  const portalTasks = [
    {
      number: 1,
      title: 'Billing history pagination',
      description: 'Invoices load in one request and time out for long-standing accounts.',
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.HIGH,
      createdBy: sarah,
    },
    {
      number: 2,
      title: 'Support dark mode in the portal shell',
      description: 'Match the palette already used by the internal tooling.',
      status: TaskStatus.TODO,
      priority: TaskPriority.LOW,
      createdBy: magd,
    },
    {
      number: 3,
      title: 'Account deletion confirmation step',
      description:
        'Deleting an account currently happens on a single click with no confirmation dialog.',
      status: TaskStatus.IN_REVIEW,
      priority: TaskPriority.URGENT,
      createdBy: sarah,
    },
  ].map((task) => ({
    ...task,
    projectId: customerPortal._id,
    key: `WEB-${task.number}`,
  }));

  const tasks = await Task.insertMany([...engineeringTasks, ...portalTasks]);
  await Project.updateOne(
    { _id: internalPlatform._id },
    { $set: { lastTaskNumber: engineeringTasks.length } },
  );
  await Project.updateOne(
    { _id: customerPortal._id },
    { $set: { lastTaskNumber: portalTasks.length } },
  );
  const taskIdByKey = new Map(tasks.map((task) => [task.key, task._id as Types.ObjectId]));
  const taskId = (key: string): Types.ObjectId => {
    const id = taskIdByKey.get(key);
    if (!id) {
      throw new Error(`Seed task missing: ${key}`);
    }
    return id;
  };

  await Comment.insertMany([
    {
      taskId: taskId('ENG-1'),
      authorId: sarah,
      content:
        'Are we keeping the refresh token in a cookie or in memory? That decision changes the whole client story.',
    },
    {
      taskId: taskId('ENG-1'),
      authorId: ammar,
      content:
        'Leaning towards httpOnly cookie. Let us confirm before anyone starts the client work.',
    },
    {
      taskId: taskId('ENG-2'),
      authorId: magd,
      content: 'Reproduced on iPad portrait. The card grid needs a two column breakpoint.',
    },
    {
      taskId: taskId('ENG-4'),
      authorId: ahmed,
      content: 'Fix is up for review. The drawer now closes on route change.',
    },
    {
      taskId: taskId('WEB-3'),
      authorId: magd,
      content: 'Support has escalated this twice this month.',
    },
  ]);

  console.warn(
    [
      '',
      'Seed complete.',
      `  users:         ${users.length}`,
      '  organizations: 1',
      '  projects:      2',
      `  tasks:         ${tasks.length}`,
      '',
      `  Sign in with any seeded email and the password: ${SEED_PASSWORD}`,
      '',
    ].join('\n'),
  );

  await mongoose.disconnect();
}

seed().catch(async (error: unknown) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
