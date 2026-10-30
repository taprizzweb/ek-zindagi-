import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ViolationKey } from '@/config/violations';
import { AppError } from '@/lib/errors';
import type { DownloadPorts } from './download';
import type { CertificatePorts, Claim } from './generate';

function fail(): never {
  throw new AppError('internal', 500);
}

interface ClaimRow {
  claimed: boolean;
  status: string;
  purged: boolean;
  officer_id: string;
  cert_code: string;
  person_name: string | null;
  area_name: string | null;
  violation: ViolationKey;
  other_text: string | null;
  photo_path: string | null;
  created_at: string;
}

export function supabaseCertificatePorts(admin: SupabaseClient): CertificatePorts {
  return {
    async ownerOf(entryId) {
      const { data, error } = await admin
        .from('entries')
        .select('officer_id')
        .eq('id', entryId)
        .maybeSingle();
      if (error) fail();
      return data ? (data as { officer_id: string }).officer_id : null;
    },
    async claim(entryId) {
      const { data, error } = await admin.rpc('claim_certificate', { p_entry_id: entryId });
      if (error) fail();
      const row = (data as ClaimRow[] | null)?.[0];
      if (!row) return null;
      return {
        claimed: row.claimed,
        status: row.status,
        purged: row.purged,
        officerId: row.officer_id,
        certCode: row.cert_code,
        personName: row.person_name,
        areaName: row.area_name,
        violation: row.violation,
        otherText: row.other_text,
        photoPath: row.photo_path,
        createdAt: row.created_at,
      } satisfies Claim;
    },
    async downloadPhoto(path) {
      const { data, error } = await admin.storage.from('photos').download(path);
      if (error || !data) fail();
      return Buffer.from(await data.arrayBuffer());
    },
    async uploadPdf(entryId, pdf) {
      const path = `${entryId}.pdf`;
      const { error } = await admin.storage.from('pdfs').upload(path, pdf, {
        contentType: 'application/pdf',
        upsert: true,
      });
      if (error) fail();
      return path;
    },
    async markReady(entryId, pdfPath) {
      const { error } = await admin
        .from('entries')
        .update({ status: 'ready', pdf_path: pdfPath, error_code: null })
        .eq('id', entryId)
        .eq('status', 'generating');
      if (error) fail();
    },
    async markFailed(entryId, errorCode) {
      const { error } = await admin
        .from('entries')
        .update({ status: 'failed', error_code: errorCode })
        .eq('id', entryId)
        .eq('status', 'generating');
      if (error) fail();
    },
  };
}

export function supabaseDownloadPorts(admin: SupabaseClient): DownloadPorts {
  return {
    async load(entryId) {
      const { data, error } = await admin
        .from('entries')
        .select(
          'officer_id, status, purged_at, cert_code, person_name, area_name, violation, other_text, photo_path, pdf_path, created_at',
        )
        .eq('id', entryId)
        .maybeSingle();
      if (error) fail();
      if (!data) return null;
      const r = data as {
        officer_id: string;
        status: string;
        purged_at: string | null;
        cert_code: string;
        person_name: string | null;
        area_name: string | null;
        violation: ViolationKey;
        other_text: string | null;
        photo_path: string | null;
        pdf_path: string | null;
        created_at: string;
      };
      return {
        officerId: r.officer_id,
        status: r.status,
        purged: r.purged_at !== null,
        certCode: r.cert_code,
        personName: r.person_name,
        areaName: r.area_name,
        violation: r.violation,
        otherText: r.other_text,
        photoPath: r.photo_path,
        pdfPath: r.pdf_path,
        createdAt: r.created_at,
      };
    },
    async downloadPdf(path) {
      const { data, error } = await admin.storage.from('pdfs').download(path);
      if (error || !data) fail();
      return Buffer.from(await data.arrayBuffer());
    },
    async downloadPhoto(path) {
      const { data, error } = await admin.storage.from('photos').download(path);
      if (error || !data) fail();
      return Buffer.from(await data.arrayBuffer());
    },
  };
}
