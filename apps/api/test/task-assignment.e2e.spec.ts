import type { INestApplication } from '@nestjs/common';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { OrganizationRole, ProjectRole } from '@projectflow/shared';
import { createTestApp, resetDatabase } from './utils/test-app';
import {
  addOrganizationMember,
  addProjectMember,
  authHeader,
  createOrganization,
  createProject,
  createTask,
  registerUser,
  type TestUser,
} from './utils/fixtures';

describe('Task assignment', () => {
  let app: INestApplication;
  let connection: Connection;

  let owner: TestUser; // organization OWNER — may assign anyone
  let member: TestUser; // plain project member — may only assign themselves
  let otherMember: TestUser; // another project member
  let outsider: TestUser; // not in the organization at all

  let projectId: string;
  let taskId: string;

  beforeAll(async () => {
    ({ app, connection } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(connection);

    owner = await registerUser(app, 'Ammar Yaser', 'ammar@example.com');
    member = await registerUser(app, 'Magd Ali', 'magd@example.com');
    otherMember = await registerUser(app, 'Ahmed Hassan', 'ahmed@example.com');
    outsider = await registerUser(app, 'Outside User', 'outside@example.com');

    const organizationId = await createOrganization(
      connection,
      'Acme Software',
      'acme-software',
      owner.id,
    );
    await addOrganizationMember(connection, organizationId, owner.id, OrganizationRole.OWNER);
    await addOrganizationMember(connection, organizationId, member.id, OrganizationRole.MEMBER);
    await addOrganizationMember(
      connection,
      organizationId,
      otherMember.id,
      OrganizationRole.MEMBER,
    );

    projectId = await createProject(
      connection,
      organizationId,
      'Internal Platform',
      'ENG',
      owner.id,
    );
    await addProjectMember(connection, projectId, member.id, ProjectRole.MEMBER);
    await addProjectMember(connection, projectId, otherMember.id, ProjectRole.MEMBER);

    taskId = await createTask(connection, projectId, 'ENG', 1, 'Fix the sidebar', owner.id);
  });

  const assign = (actor: TestUser, assigneeId: string | null) =>
    request(app.getHttpServer())
      .patch(`/tasks/${taskId}/assignee`)
      .set('Authorization', authHeader(actor))
      .send({ assigneeId });

  it('lets a project member assign themselves', async () => {
    const response = await assign(member, member.id).expect(200);
    expect(response.body.assignee).toMatchObject({ id: member.id });
  });

  it('lets an authorized role assign another project member', async () => {
    const response = await assign(owner, member.id).expect(200);
    expect(response.body.assignee).toMatchObject({ id: member.id });
  });

  it('refuses to let a plain member assign someone else', async () => {
    await assign(member, otherMember.id).expect(403);
  });

  it('refuses to assign a user who is not a project member', async () => {
    await assign(owner, outsider.id).expect(403);
  });

  it('records an activity entry when the assignee changes', async () => {
    await assign(owner, member.id).expect(200);
    await assign(owner, otherMember.id).expect(200);

    const response = await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activity`)
      .set('Authorization', authHeader(owner))
      .expect(200);

    expect(response.body.total).toBe(2);
    // Newest first.
    expect(response.body.items[0]).toMatchObject({
      actor: { id: owner.id },
      from: { id: member.id },
      to: { id: otherMember.id },
    });
  });

  it('records an activity entry when a task is unassigned', async () => {
    await assign(owner, member.id).expect(200);
    await assign(owner, null).expect(200);

    const response = await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activity`)
      .set('Authorization', authHeader(owner))
      .expect(200);

    expect(response.body.items[0]).toMatchObject({ from: { id: member.id }, to: null });
  });

  it('refuses to show activity to a user outside the project', async () => {
    await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activity`)
      .set('Authorization', authHeader(outsider))
      .expect(403);
  });

  it('refuses to let an outsider change the status of another project task', async () => {
    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}/status`)
      .set('Authorization', authHeader(outsider))
      .send({ status: 'DONE' })
      .expect(403);
  });

  it('gives concurrently created tasks distinct identifiers', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        request(app.getHttpServer())
          .post(`/projects/${projectId}/tasks`)
          .set('Authorization', authHeader(owner))
          .send({ title: `Concurrent task ${index}` }),
      ),
    );

    for (const response of responses) {
      expect(response.status).toBe(201);
    }

    const keys = responses.map((response) => response.body.key as string);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
