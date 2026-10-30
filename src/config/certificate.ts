/**
 * Fixed wording on the certificate. The NGO can edit the campaign lines here.
 * The disclaimer, the corner stamp and the watermark are NOT settings: they are part of the
 * template itself (src/lib/pdf/template.ts) so no configuration can switch them off.
 */
export const CERTIFICATE_TEXT = {
  campaign: 'PROJECT EK ZINDAGI',
  campaignSuffix: 'ROAD SAFETY AWARENESS',
  headline: ['YOUR NEXT MISTAKE', 'SHOULD NOT BE YOUR LAST'],
  subtitle: 'A hypothetical illustration of what a small mistake on the road can lead to',
  quoteOpening: 'A small mistake on the road can have life-changing consequences.',
  hindiSlogan: 'एक ज़िंदगी, एक ही मौका — सड़क पर सावधानी रखें।',
  footerCampaign: 'EK ZINDAGI CAMPAIGN',
  policeLine: 'In association with Rajasthan Police',
} as const;
