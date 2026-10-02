/** Jeton d'injection de la passerelle de paiement : l'adapter Stripe est remplacé par un faux dans les tests. */
export const PAYMENTS_GATEWAY = Symbol('PAYMENTS_GATEWAY');

export interface ConnectAccountState {
  /** Le compte peut recevoir l'argent des réservations (capacité « transferts » active chez Stripe). */
  chargesEnabled: boolean;
  /** Le prestataire a rempli le formulaire d'inscription. */
  detailsSubmitted: boolean;
}

export interface ConnectAccountInput {
  providerId: string;
  /** Email du prestataire : Stripe l'exige pour un compte qui reçoit des fonds. Jamais loggué. */
  contactEmail: string;
  /** Nom du prestataire, affiché dans le tableau de bord Stripe. */
  displayName: string;
}

export interface CheckoutSessionInput {
  bookingId: string;
  amountCents: number;
  /** Commission de la plateforme, déjà calculée par le serveur. */
  feeCents: number;
  currency: string;
  /** Compte Connect du prestataire, qui reçoit le montant moins la commission. */
  destinationAccountId: string;
  productName: string;
  description: string;
  /** Préremplit la page de paiement. */
  customerEmail: string | undefined;
  /** Fin de la session : la même que celle du hold. */
  expiresAt: Date;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  sessionId: string;
  /** Adresse de la page de paiement ; `null` quand la session est terminée ou expirée. */
  url: string | null;
}

/**
 * Prestataire de paiement (Stripe Connect). Chaque opération d'écriture porte une clé d'idempotence
 * dérivée de nos identifiants : deux appels simultanés ne créent ni second compte, ni seconde
 * session, ni second remboursement.
 */
export interface PaymentsGateway {
  createConnectAccount(input: ConnectAccountInput): Promise<{ accountId: string }>;
  createAccountLink(input: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
  retrieveAccount(accountId: string): Promise<ConnectAccountState>;
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession>;
  retrieveCheckoutSession(sessionId: string): Promise<CheckoutSession>;
  /** Ferme une session encore ouverte ; sans effet si elle est déjà terminée. */
  expireCheckoutSession(sessionId: string): Promise<void>;
  /** Rembourse tout le paiement, reprend le versement au prestataire et rend la commission. */
  refund(input: { paymentIntentId: string; bookingId: string }): Promise<void>;
}

export type PaymentsGatewayFailure =
  | 'not_configured'
  | 'network'
  | 'rate_limited'
  | 'authentication'
  | 'invalid_request'
  | 'api_error';

/** Échec de la passerelle. `reason` et `code` sont loggables : ni clé, ni email, ni montant. */
export class PaymentsGatewayError extends Error {
  constructor(
    readonly reason: PaymentsGatewayFailure,
    /** Code d'erreur du prestataire (ex. `account_invalid`), s'il en donne un. */
    readonly code?: string,
  ) {
    super(`Passerelle de paiement indisponible (${reason}${code ? `, ${code}` : ''})`);
    this.name = 'PaymentsGatewayError';
  }
}

/** Passerelle utilisée quand `STRIPE_SECRET_KEY` est absente : l'API démarre, les paiements répondent 503. */
export class UnconfiguredPaymentsGateway implements PaymentsGateway {
  private fail(): never {
    throw new PaymentsGatewayError('not_configured');
  }
  createConnectAccount = async (): Promise<never> => this.fail();
  createAccountLink = async (): Promise<never> => this.fail();
  retrieveAccount = async (): Promise<never> => this.fail();
  createCheckoutSession = async (): Promise<never> => this.fail();
  retrieveCheckoutSession = async (): Promise<never> => this.fail();
  expireCheckoutSession = async (): Promise<never> => this.fail();
  refund = async (): Promise<never> => this.fail();
}
