import { PDFDocument } from 'pdf-lib';
import { formatCertificateDateTime } from './template';

/**
 * Writes the certificate code and date into the PDF's own properties. The person's name is
 * deliberately NOT in the metadata: it would survive in file listings and previews.
 */
export async function stampMetadata(
  pdf: Buffer,
  certCode: string,
  createdAt: Date,
): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf);
  const when = formatCertificateDateTime(createdAt);
  doc.setTitle(`EK ZINDAGI awareness certificate ${certCode}`);
  doc.setSubject(
    `Hypothetical road safety awareness illustration. Code ${certCode}. Issued ${when} IST.`,
  );
  doc.setKeywords([certCode, createdAt.toISOString(), 'FOR AWARENESS PURPOSE ONLY']);
  doc.setAuthor('Project EK ZINDAGI');
  doc.setCreator('EK ZINDAGI');
  doc.setProducer('EK ZINDAGI');
  doc.setCreationDate(createdAt);
  doc.setModificationDate(createdAt);
  return Buffer.from(await doc.save());
}
