export interface DeliveryInput {
  entryId: string;
  actor: { id: string; officerCode: string | null };
  /** When set, only that officer may send it. A supervisor retrying a failure leaves it out. */
  onlyOfficerId?: string;
}

export type DeliveryResult =
  | { mode: 'bridge'; waUrl: string; expiresAt: string }
  | { mode: 'cloud_api'; status: string; alreadySent: boolean };

/**
 * One interface for both ways of delivering a certificate, chosen by DELIVERY_MODE. The rest of the
 * app calls `send` and never needs to know which mode is running.
 */
export interface DeliveryProvider {
  readonly mode: 'bridge' | 'cloud_api';
  send(input: DeliveryInput): Promise<DeliveryResult>;
}
