import { type ApiError, apiErrorSchema, type ErrorCode } from '@creno/shared';

/** Messages utilisateur par code d'erreur de l'API (jamais le message technique brut). */
const messages: Partial<Record<ErrorCode, string>> = {
  INVALID_CREDENTIALS: 'Email ou mot de passe incorrect.',
  REGISTRATION_LINK_INVALID: "Ce lien d'inscription est invalide ou a expiré.",
  SESSION_EXPIRED: 'Votre session a expiré. Reconnectez-vous.',
  UNAUTHORIZED: 'Connectez-vous pour continuer.',
  FORBIDDEN: "Vous n'avez pas accès à cette page.",
  FORBIDDEN_OWNERSHIP: "Cette ressource n'est pas la vôtre.",
  TOO_MANY_REQUESTS: 'Trop de tentatives. Réessayez dans une minute.',
  VALIDATION_FAILED: 'Certains champs sont invalides.',
  NOT_FOUND: 'Élément introuvable.',
  ALREADY_EXISTS: 'Cet élément existe déjà.',
  PROVIDER_PROFILE_REQUIRED: "Créez d'abord votre profil prestataire.",
  SLOT_UNAVAILABLE: "Ce créneau vient d'être pris. Choisissez-en un autre.",
  SLOT_NOT_OFFERED: "Ce créneau n'est plus proposé.",
  LIMIT_REACHED: "Limite atteinte. Supprimez des éléments avant d'en ajouter.",
  HOLD_LIMIT_REACHED: 'Vous avez trop de réservations en attente de paiement.',
  GEOCODING_UNAVAILABLE: "La recherche d'adresse est momentanément indisponible.",
  BOOKING_NOT_PAYABLE: "Cette réservation n'est plus en attente de paiement.",
  PROVIDER_PAYMENTS_NOT_READY: "Ce prestataire n'accepte pas encore le paiement en ligne.",
  PAYMENT_PROVIDER_UNAVAILABLE:
    'Le paiement est momentanément indisponible. Réessayez dans un instant.',
  CANCELLATION_NOT_ALLOWED: 'Cette réservation ne peut plus être annulée en ligne.',
  PHONE_NOT_ALLOWED: 'Seuls les numéros mobiles français (06 ou 07) sont acceptés pour l’instant.',
  PHONE_CODE_INVALID: 'Code incorrect ou expiré.',
};

const FALLBACK = 'Une erreur est survenue. Réessayez.';

export class ApiClientError extends Error {
  readonly code: ErrorCode | 'NETWORK_ERROR';
  readonly statusCode: number;
  /** Erreurs par champ renvoyées par l'API (`details.fieldErrors`). */
  readonly fieldErrors: Record<string, string[]>;

  constructor(error: ApiError | null, statusCode: number) {
    super((error && messages[error.code]) ?? FALLBACK);
    this.name = 'ApiClientError';
    this.code = error?.code ?? 'NETWORK_ERROR';
    this.statusCode = statusCode;
    this.fieldErrors = extractFieldErrors(error?.details);
  }
}

function extractFieldErrors(details: unknown): Record<string, string[]> {
  if (!details || typeof details !== 'object' || !('fieldErrors' in details)) return {};
  const { fieldErrors } = details;
  if (!fieldErrors || typeof fieldErrors !== 'object') return {};
  return Object.fromEntries(
    Object.entries(fieldErrors).filter(
      (entry): entry is [string, string[]] =>
        Array.isArray(entry[1]) && entry[1].every((m) => typeof m === 'string'),
    ),
  );
}

export async function toApiClientError(res: Response): Promise<ApiClientError> {
  const parsed = apiErrorSchema.safeParse(await res.json().catch(() => null));
  return new ApiClientError(parsed.success ? parsed.data : null, res.status);
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiClientError ? error.message : FALLBACK;
}
