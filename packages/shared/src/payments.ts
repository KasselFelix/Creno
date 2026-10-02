import { z } from 'zod';

/**
 * État du compte Stripe Connect d'un prestataire :
 * - `not_started` : aucun compte créé ;
 * - `pending` : compte créé, mais Stripe n'autorise pas encore les paiements (formulaire incomplet ou vérification en cours) ;
 * - `active` : le prestataire peut encaisser.
 */
export const connectStatuses = ['not_started', 'pending', 'active'] as const;
export const connectStatusValueSchema = z.enum(connectStatuses);
export type ConnectStatusValue = z.infer<typeof connectStatusValueSchema>;

export const connectStatusSchema = z.object({
  status: connectStatusValueSchema,
  /** Vrai quand le prestataire a rempli le formulaire Stripe : il ne reste que la vérification. */
  detailsSubmitted: z.boolean(),
  /** Commission Creno en points de base (1000 = 10 %). */
  feeBps: z.number().int(),
});
export type ConnectStatus = z.infer<typeof connectStatusSchema>;

/** Lien à usage unique vers le formulaire d'inscription hébergé par Stripe. */
export const connectOnboardingSchema = z.object({ url: z.url({ protocol: /^https$/ }) });
export type ConnectOnboarding = z.infer<typeof connectOnboardingSchema>;

export const paymentStatuses = ['succeeded', 'refunded'] as const;
export const paymentStatusSchema = z.enum(paymentStatuses);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

/** Commission de la plateforme sur un prix, en centimes. */
export function platformFeeCents(priceCents: number, feeBps: number): number {
  return Math.round((priceCents * feeBps) / 10_000);
}
