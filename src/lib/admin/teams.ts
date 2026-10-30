import { randomBytes } from 'node:crypto';
import type { AuditSink } from '@/lib/audit/audit';
import { newLinkToken } from '@/lib/delivery/token';
import { AppError } from '@/lib/errors';
import { setOfficerActive, type Actor, type OfficerStore } from './officers';

/** What the team rules need besides the officer store: where the (hash of the) link is kept. */
export interface TeamStore extends OfficerStore {
  /** Stores the hash as the team's one link and returns the version (when it was set). */
  saveLink(profileId: string, tokenHash: string): Promise<void>;
}

export interface TeamDeps {
  store: TeamStore;
  audit: AuditSink;
  newToken?: () => { token: string; hash: string };
  randomHex?: (bytes: number) => string;
}

function requireAdmin(actor: Actor): void {
  if (actor.role !== 'admin') throw new AppError('forbidden', 403);
}

const hex = (n: number) => randomBytes(n).toString('hex');

/**
 * A team is a station or a group that shares one link. It is an officer-role account with no password anyone knows
 * (a random one is set and thrown away). The link is returned ONCE: only its hash is stored.
 */
export async function createTeam(
  deps: TeamDeps,
  actor: Actor,
  label: string,
): Promise<{ id: string; officerCode: string; token: string }> {
  requireAdmin(actor);
  const random = deps.randomHex ?? hex;
  const email = `team-${random(6)}@teams.invalid`;
  const { id } = await deps.store.createAuthUser(email, random(24));
  let officerCode: string;
  const { token, hash } = (deps.newToken ?? newLinkToken)();
  try {
    ({ officerCode } = await deps.store.insertProfile({
      id,
      email,
      displayName: label,
      role: 'officer',
      createdBy: actor.id,
    }));
    await deps.store.setMustChangePassword(id, false);
    await deps.store.saveLink(id, hash);
  } catch (err) {
    await deps.store.deleteAuthUser(id).catch(() => undefined);
    throw err;
  }
  await deps.audit.record({
    action: 'team_created',
    actorId: actor.id,
    actorCode: actor.officerCode,
    meta: { target_code: officerCode },
  });
  return { id, officerCode, token };
}

/** A new link for the team. Every phone that holds the old one stops working at once. */
export async function changeTeamLink(
  deps: TeamDeps,
  actor: Actor,
  teamId: string,
): Promise<{ token: string }> {
  requireAdmin(actor);
  const target = await deps.store.getProfile(teamId);
  if (!target || target.role !== 'officer') throw new AppError('not_found', 404);
  const { token, hash } = (deps.newToken ?? newLinkToken)();
  await deps.store.saveLink(teamId, hash);
  await deps.audit.record({
    action: 'team_link_changed',
    actorId: actor.id,
    actorCode: actor.officerCode,
    meta: { target_code: target.officerCode },
  });
  return { token };
}

export const setTeamActive = setOfficerActive;
