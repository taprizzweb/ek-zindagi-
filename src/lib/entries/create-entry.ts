import type { AuditSink } from '@/lib/audit/audit';
import { otherText } from '@/config/violations';
import type { Role } from '@/lib/domain/roles';
import { AppError } from '@/lib/errors';
import type { EntryInput } from '@/lib/validation/entry';

export interface NewEntryRow {
  id: string;
  certCode: string;
  officerId: string;
  clientRequestId: string;
  violation: EntryInput['violation'];
  otherText: string | null;
  areaName: string;
  lat: number | null;
  lng: number | null;
  locationSource: 'gps' | 'manual';
  photoSource: 'none' | 'camera' | 'gallery';
  galleryReason: string | null;
  consentChecked: boolean;
  phoneHash: string;
  personName: string;
  phoneE164: string;
  photoPath: string | null;
  expiresAt: string;
}

export interface ExistingEntry {
  id: string;
  certCode: string;
  status: string;
  createdAt: string;
}

export type InsertResult =
  { ok: true; createdAt: string } | { ok: false; conflict: 'cert_code' | 'request' };

/** Everything the intake rules need from the outside world. */
export interface EntryPorts {
  findByRequestId(officerId: string, requestId: string): Promise<ExistingEntry | null>;
  isOptedOut(phoneHash: string): Promise<boolean>;
  hasRecentEntry(phoneHash: string, sinceIso: string): Promise<boolean>;
  uploadPhoto(entryId: string, jpeg: Buffer): Promise<string>;
  deletePhoto(path: string): Promise<void>;
  insertEntry(row: NewEntryRow): Promise<InsertResult>;
  /** True while within the limit. */
  rateLimit(key: string, windowSeconds: number, maxHits: number): Promise<boolean>;
}

export interface IntakeConfig {
  allowGallery: boolean;
  dedupeHours: number;
  retentionHours: number;
  maxPerOfficerHour: number;
  maxPerOfficerDay: number;
  maxPerIpHour: number;
}

export interface IntakeDeps {
  ports: EntryPorts;
  audit: AuditSink;
  config: IntakeConfig;
  hashPhone(e164: string): string;
  processPhoto(raw: Buffer): Promise<Buffer>;
  generateCode(): string;
  newId(): string;
  now(): Date;
}

export interface IntakeActor {
  id: string;
  role: Role;
  officerCode: string | null;
}

export interface CreatedEntry extends ExistingEntry {
  replayed: boolean;
}

const MAX_CODE_ATTEMPTS = 5;

export async function createEntry(
  deps: IntakeDeps,
  actor: IntakeActor,
  input: EntryInput,
  rawPhoto: Buffer | null,
  ip: string,
): Promise<CreatedEntry> {
  const { ports, config } = deps;
  if (actor.role !== 'officer' && actor.role !== 'supervisor') throw new AppError('forbidden', 403);

  // A retry of a submission that already went through returns the same entry.
  const existing = await ports.findByRequestId(actor.id, input.clientRequestId);
  if (existing) return { ...existing, replayed: true };

  if ((input.photoSource === 'none') !== (rawPhoto === null))
    throw new AppError('bad_request', 400);
  if (input.photoSource === 'gallery' && !config.allowGallery)
    throw new AppError('gallery_disabled', 403);

  const within = await Promise.all([
    ports.rateLimit(`entry:officer:${actor.id}:h`, 3600, config.maxPerOfficerHour),
    ports.rateLimit(`entry:officer:${actor.id}:d`, 86400, config.maxPerOfficerDay),
    ports.rateLimit(`entry:ip:${ip}:h`, 3600, config.maxPerIpHour),
  ]);
  if (within.includes(false)) throw new AppError('rate_limited', 429);

  const phoneHash = deps.hashPhone(input.phone);
  if (await ports.isOptedOut(phoneHash)) throw new AppError('opted_out', 409);
  const since = new Date(deps.now().getTime() - config.dedupeHours * 3_600_000).toISOString();
  if (await ports.hasRecentEntry(phoneHash, since)) throw new AppError('duplicate_recent', 409);

  const jpeg = rawPhoto ? await deps.processPhoto(rawPhoto) : null;
  const id = deps.newId();
  const photoPath = jpeg ? await ports.uploadPhoto(id, jpeg) : null;
  const cleanup = async () => {
    if (photoPath) await ports.deletePhoto(photoPath).catch(() => undefined);
  };

  const location = input.location;
  const row = (certCode: string): NewEntryRow => ({
    id,
    certCode,
    officerId: actor.id,
    clientRequestId: input.clientRequestId,
    violation: input.violation,
    otherText:
      input.violation === 'other' && input.otherChoice
        ? otherText(input.otherChoice, input.otherTyped)
        : null,
    areaName: location.areaName,
    lat: location.source === 'gps' ? location.lat : null,
    lng: location.source === 'gps' ? location.lng : null,
    locationSource: location.source,
    photoSource: input.photoSource,
    galleryReason: input.galleryReason ?? null,
    consentChecked: input.consentChecked,
    phoneHash,
    personName: input.name,
    phoneE164: input.phone,
    photoPath,
    expiresAt: new Date(deps.now().getTime() + config.retentionHours * 3_600_000).toISOString(),
  });

  let saved = false;
  try {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const certCode = deps.generateCode();
      const result = await ports.insertEntry(row(certCode));
      if (result.ok) {
        saved = true;
        await deps.audit.record({
          action: 'entry_created',
          actorId: actor.id,
          actorCode: actor.officerCode,
          entryId: id,
          meta: {
            violation: input.violation,
            photo_source: input.photoSource,
            location_source: location.source,
          },
        });
        return { id, certCode, status: 'saved', createdAt: result.createdAt, replayed: false };
      }
      if (result.conflict === 'request') {
        // Two submissions of the same form raced; the other one won.
        await cleanup();
        const winner = await ports.findByRequestId(actor.id, input.clientRequestId);
        if (winner) return { ...winner, replayed: true };
        throw new AppError('internal', 500);
      }
    }
    throw new AppError('internal', 500, 'Could not allocate a unique certificate code');
  } catch (err) {
    if (!saved) await cleanup(); // never leave an orphaned photo behind
    throw err;
  }
}
