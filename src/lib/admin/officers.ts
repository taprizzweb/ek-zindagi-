import type { AuditSink } from '@/lib/audit/audit';
import { generateTempPassword } from '@/lib/domain/password';
import type { CreatableRole, Role } from '@/lib/domain/roles';
import { AppError } from '@/lib/errors';

export interface ProfileRecord {
  id: string;
  role: Role;
  officerCode: string | null;
  active: boolean;
}

/** Everything the officer-management rules need from the outside world. */
export interface OfficerStore {
  getProfile(id: string): Promise<ProfileRecord | null>;
  /** Throws AppError('email_taken') when the address is already registered. */
  createAuthUser(email: string, password: string): Promise<{ id: string }>;
  deleteAuthUser(id: string): Promise<void>;
  insertProfile(p: {
    id: string;
    email: string;
    displayName: string;
    role: CreatableRole;
    createdBy: string;
  }): Promise<{ officerCode: string }>;
  setActive(id: string, active: boolean): Promise<void>;
  setBanned(id: string, banned: boolean): Promise<void>;
  setPassword(id: string, password: string): Promise<void>;
  setMustChangePassword(id: string, value: boolean): Promise<void>;
  revokeSessions(id: string): Promise<void>;
}

export interface Deps {
  store: OfficerStore;
  audit: AuditSink;
  generatePassword?: () => string;
}

export interface Actor {
  id: string;
  role: Role;
  officerCode: string | null;
}

function requireAdmin(actor: Actor): void {
  if (actor.role !== 'admin') throw new AppError('forbidden', 403);
}

async function loadManageable(deps: Deps, actor: Actor, targetId: string): Promise<ProfileRecord> {
  if (targetId === actor.id) throw new AppError('forbidden', 403, 'Cannot act on your own account');
  const target = await deps.store.getProfile(targetId);
  if (!target) throw new AppError('not_found', 404);
  if (target.role === 'admin')
    throw new AppError('forbidden', 403, 'Admin accounts are not managed here');
  return target;
}

export async function createOfficer(
  deps: Deps,
  actor: Actor,
  input: { email: string; displayName: string; role: CreatableRole },
): Promise<{ id: string; officerCode: string; tempPassword: string }> {
  requireAdmin(actor);
  const tempPassword = (deps.generatePassword ?? generateTempPassword)();
  const { id } = await deps.store.createAuthUser(input.email, tempPassword);
  let officerCode: string;
  try {
    ({ officerCode } = await deps.store.insertProfile({
      id,
      email: input.email,
      displayName: input.displayName,
      role: input.role,
      createdBy: actor.id,
    }));
  } catch (err) {
    await deps.store.deleteAuthUser(id).catch(() => undefined); // do not leave a login without a profile
    throw err;
  }
  await deps.audit.record({
    action: 'officer_created',
    actorId: actor.id,
    actorCode: actor.officerCode,
    meta: { target_code: officerCode, role: input.role },
  });
  return { id, officerCode, tempPassword };
}

export async function setOfficerActive(
  deps: Deps,
  actor: Actor,
  targetId: string,
  active: boolean,
): Promise<void> {
  requireAdmin(actor);
  const target = await loadManageable(deps, actor, targetId);
  if (active) {
    await deps.store.setBanned(targetId, false);
    await deps.store.setActive(targetId, true);
  } else {
    // Profile first: every request checks it, so access ends immediately.
    await deps.store.setActive(targetId, false);
    await deps.store.setBanned(targetId, true);
    await deps.store.revokeSessions(targetId);
  }
  await deps.audit.record({
    action: active ? 'officer_enabled' : 'officer_disabled',
    actorId: actor.id,
    actorCode: actor.officerCode,
    meta: { target_code: target.officerCode },
  });
}

export async function resetOfficerPassword(
  deps: Deps,
  actor: Actor,
  targetId: string,
): Promise<{ tempPassword: string }> {
  requireAdmin(actor);
  const target = await loadManageable(deps, actor, targetId);
  const tempPassword = (deps.generatePassword ?? generateTempPassword)();
  await deps.store.setMustChangePassword(targetId, true); // before the password, never after
  await deps.store.setPassword(targetId, tempPassword);
  await deps.store.revokeSessions(targetId);
  await deps.audit.record({
    action: 'officer_password_reset',
    actorId: actor.id,
    actorCode: actor.officerCode,
    meta: { target_code: target.officerCode },
  });
  return { tempPassword };
}
