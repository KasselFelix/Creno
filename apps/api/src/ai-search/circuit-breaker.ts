import type { Clock } from '../common/clock.js';

export interface CircuitBreakerOptions {
  /** Interprétations consécutives en échec (après reprise) qui ouvrent le circuit. */
  failureThreshold: number;
  /** Durée d'ouverture : aucun appel au modèle pendant ce temps. */
  openMs: number;
}

export const CIRCUIT_DEFAULTS: CircuitBreakerOptions = { failureThreshold: 5, openMs: 30_000 };

type State = 'closed' | 'open' | 'half_open';

/**
 * Circuit breaker : quand le modèle est en panne, on arrête de l'appeler pendant un temps, au lieu
 * de faire attendre chaque visiteur jusqu'au timeout. Fermé : appels normaux. Ouvert : aucun appel.
 * Demi-ouvert (après `openMs`) : une seule requête essaie ; succès → fermé, échec → rouvert.
 *
 * État en mémoire, propre à chaque réplica et remis à zéro à son démarrage : suffisant pour ne pas
 * insister sur un fournisseur en panne, sans dépendre d'un stockage partagé.
 */
export class CircuitBreaker {
  private state: State = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private trialInFlight = false;

  constructor(
    private readonly clock: Clock,
    private readonly options: CircuitBreakerOptions = CIRCUIT_DEFAULTS,
  ) {}

  /** Le modèle peut-il être appelé maintenant ? Sans effet sur l'état. */
  canAttempt(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open') return this.clock.now() - this.openedAt >= this.options.openMs;
    return !this.trialInFlight;
  }

  /** Réserve un appel. Une fois la durée d'ouverture passée, une seule requête obtient l'essai. */
  acquire(): boolean {
    if (!this.canAttempt()) return false;
    if (this.state !== 'closed') {
      this.state = 'half_open';
      this.trialInFlight = true;
    }
    return true;
  }

  /** Le modèle a répondu, même mal (une sortie invalide n'est pas une panne). `true` : il se referme. */
  recordSuccess(): boolean {
    const reclosed = this.state !== 'closed';
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.trialInFlight = false;
    return reclosed;
  }

  /** Échec d'indisponibilité après reprise. `true` : le circuit vient de s'ouvrir. */
  recordFailure(): boolean {
    if (this.state === 'half_open') {
      this.open();
      return true;
    }
    this.consecutiveFailures += 1;
    if (this.state === 'closed' && this.consecutiveFailures >= this.options.failureThreshold) {
      this.open();
      return true;
    }
    return false;
  }

  /** Ni réponse ni panne (requête refusée, erreur inattendue) : libère l'essai sans rien trancher. */
  recordNeutral(): void {
    this.trialInFlight = false;
  }

  private open(): void {
    this.state = 'open';
    this.openedAt = this.clock.now();
    this.consecutiveFailures = 0;
    this.trialInFlight = false;
  }
}
