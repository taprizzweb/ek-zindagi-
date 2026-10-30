import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ViolationKey } from '@/config/violations';
import { AppError } from '@/lib/errors';
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
