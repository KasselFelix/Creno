import { Inject, Injectable, Logger } from '@nestjs/common';
import { type DbHandle, sqlState } from '@creno/db';
import {
  type CompleteRegistrationInput,
  EMAIL_VERIFICATION_TTL_HOURS,
  type LoginInput,
  type PublicUser,
  type RegisterInput,
  type RegistrationEmailJob,
  type Session,
} from '@creno/shared';
import { DomainError } from '../common/domain-error.js';
import { DB } from '../database/database.module.js';
import { JobsService } from '../jobs/jobs.service.js';
import { toPublicUser } from '../users/users.mapper.js';
import { type UserRow, UsersRepository } from '../users/users.repository.js';
import type { AuthUser } from './auth.types.js';
import { PasswordHasher } from './password-hasher.js';
import {
  type PendingRegistrationRow,
  PendingRegistrationsRepository,
} from './pending-registrations.repository.js';
import {
  MAX_REGISTRATION_EMAILS_PER_ADDRESS_PER_HOUR,
  REGISTRATION_EMAIL_QUEUE,
} from './registration.queues.js';
import { type SessionRow, SessionsRepository } from './sessions.repository.js';
import { TokensService } from './tokens.service.js';

/** Un ancien refresh token reste accepté ce délai après rotation (refresh simultanés de plusieurs onglets). */
export const REFRESH_GRACE_MS = 10_000;
/** Durée de vie absolue d'une session : au-delà, il faut se reconnecter, même si elle sert tous les jours. */
export const SESSION_MAX_AGE_MS = 90 * 24 * 60 * 60_000;
const USER_AGENT_MAX_LENGTH = 200;
const EMAIL_VERIFICATION_TTL_MS = EMAIL_VERIFICATION_TTL_HOURS * 60 * 60_000;

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  /** Absent pendant le délai de grâce : le navigateur a déjà reçu le nouveau refresh token. */
  refreshToken?: string;
}

const sessionExpired = () =>
  new DomainError('SESSION_EXPIRED', 401, 'Session expirée, reconnectez-vous.');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokensService,
    private readonly pending: PendingRegistrationsRepository,
    private readonly jobs: JobsService,
  ) {}

  /**
   * Demande d'inscription : une adresse, rien d'autre. Aucun compte n'est créé ici, seulement une
   * demande en attente et le job qui enverra l'email. La requête ne lit pas `users` : sa réponse et
   * sa durée sont les mêmes que l'adresse ait déjà un compte ou non.
   */
  async register(input: RegisterInput): Promise<void> {
    const pendingRegistrationId = await this.handle.db.transaction(async (tx) => {
      await this.pending.lockEmail(input.email, tx);
      const recent = await this.pending.countLastHour(input.email, tx);
      if (recent >= MAX_REGISTRATION_EMAILS_PER_ADDRESS_PER_HOUR) return undefined;
      const row = await this.pending.create(
        { email: input.email, expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS) },
        tx,
      );
      // Le job naît avec la ligne (outbox transactionnelle) : pas de demande sans email.
      const job: RegistrationEmailJob = { pendingRegistrationId: row.id };
      await this.jobs.send(REGISTRATION_EMAIL_QUEUE, job, { tx });
      return row.id;
    });
    if (pendingRegistrationId) {
      this.logger.log({ event: 'auth.registration_requested', pendingRegistrationId });
    } else {
      // Même réponse pour l'appelant, mais aucun email de plus ne part vers cette adresse.
      this.logger.warn({ event: 'auth.registration_capped' });
    }
  }

  /**
   * Fin de l'inscription, depuis le lien : le jeton prouve l'accès à la boîte mail, et c'est son
   * titulaire qui choisit ici nom, rôle et mot de passe. Le compte est créé avec une première
   * session, et toutes les demandes en attente de l'adresse disparaissent (leurs liens avec).
   */
  async completeRegistration(
    input: CompleteRegistrationInput,
    userAgent: string | undefined,
  ): Promise<AuthResult> {
    const parts = this.tokens.parseToken(input.token);
    if (!parts) throw this.registrationLinkRejected('malformed');
    const presented = this.tokens.hashSecret(parts.secret);
    // Lien vérifié avant de calculer le hash : un jeton bidon ne coûte pas un argon2.
    this.usablePending(await this.pending.findById(parts.id), presented);
    const passwordHash = await this.hasher.hash(input.password);
    const secret = this.tokens.newSecret();
    try {
      const { user, session } = await this.handle.db.transaction(async (tx) => {
        // Deux liens d'une même adresse utilisés en même temps : le second attend ici, puis
        // constate à la relecture que sa ligne a été supprimée par le premier.
        const seen = this.usablePending(await this.pending.findById(parts.id, tx), presented);
        await this.pending.lockEmail(seen.email, tx);
        const pending = this.usablePending(await this.pending.findById(parts.id, tx), presented);
        const user = await this.users.create(
          {
            email: pending.email,
            fullName: input.fullName,
            role: input.role,
            passwordHash,
            emailVerifiedAt: new Date(),
          },
          tx,
        );
        await this.pending.deleteByEmail(pending.email, tx);
        const session = await this.sessions.create(
          this.newSessionValues(user.id, secret, userAgent),
          tx,
        );
        return { user, session };
      });
      this.logger.log({ event: 'auth.registered', userId: user.id, role: user.role });
      return this.issue(user, session, secret);
    } catch (error) {
      // Filet de sécurité : un compte existe déjà pour cette adresse (créé hors de ce parcours).
      if (sqlState(error) === '23505') throw this.registrationLinkRejected('account_exists');
      throw error;
    }
  }

  async login(input: LoginInput, userAgent: string | undefined): Promise<AuthResult> {
    const user = await this.users.findByEmail(input.email);
    const valid = await this.hasher.verify(user?.passwordHash, input.password);
    if (!user || !valid) {
      this.logger.warn({
        event: 'auth.login_failed',
        reason: user ? 'bad_password' : 'unknown_email',
      });
      throw new DomainError('INVALID_CREDENTIALS', 401, 'Email ou mot de passe incorrect.');
    }
    await this.sessions.purgeDead(user.id);
    const secret = this.tokens.newSecret();
    const session = await this.sessions.create(this.newSessionValues(user.id, secret, userAgent));
    this.logger.log({ event: 'auth.logged_in', userId: user.id, sessionId: session.id });
    return this.issue(user, session, secret);
  }

  /**
   * Refresh rotatif : le token présenté est échangé contre un nouveau. Un token déjà remplacé
   * (hors délai de grâce) signale un vol ou un rejeu : la session entière est révoquée.
   */
  async refresh(rawToken: unknown): Promise<AuthResult> {
    const parts = this.tokens.parseToken(rawToken);
    if (!parts) throw sessionExpired();

    const session = await this.sessions.findById(parts.id);
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw sessionExpired();

    const presented = this.tokens.hashSecret(parts.secret);
    if (this.tokens.sameHash(session.refreshTokenHash, presented)) {
      const secret = this.tokens.newSecret();
      const rotated = await this.sessions.rotate(
        session.id,
        presented,
        this.tokens.hashSecret(secret),
        this.nextExpiry(session),
      );
      // Perdu la course contre un refresh simultané : l'ancien hash est désormais « previous ».
      if (!rotated)
        return this.refreshWithinGrace(await this.sessions.findById(session.id), presented);
      const user = await this.activeUser(session.userId);
      this.logger.log({ event: 'auth.refreshed', userId: user.id, sessionId: session.id });
      return this.issue(user, rotated, secret);
    }

    return this.refreshWithinGrace(session, presented);
  }

  /**
   * Déconnexion par le refresh token : elle marche même quand l'access token a expiré (onglet
   * resté ouvert). Un token inconnu ou déjà mort ne provoque pas d'erreur : le résultat voulu
   * (plus de session) est déjà atteint.
   */
  async logout(rawToken: unknown): Promise<void> {
    const parts = this.tokens.parseToken(rawToken);
    if (!parts) return;
    const session = await this.sessions.findById(parts.id);
    if (!session || session.revokedAt) return;
    const presented = this.tokens.hashSecret(parts.secret);
    const owns =
      this.tokens.sameHash(session.refreshTokenHash, presented) ||
      this.tokens.sameHash(session.previousTokenHash, presented);
    if (!owns) return;
    await this.sessions.revoke(session.id);
    this.logger.log({ event: 'auth.logged_out', userId: session.userId, sessionId: session.id });
  }

  async listSessions(current: AuthUser): Promise<Session[]> {
    const rows = await this.sessions.listActive(current.id);
    return rows.map((row) => ({
      id: row.id,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      current: row.id === current.sessionId,
    }));
  }

  async revokeSession(current: AuthUser, sessionId: string): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    if (!session) throw new DomainError('NOT_FOUND', 404, 'Session introuvable.');
    if (session.userId !== current.id) {
      throw new DomainError('FORBIDDEN_OWNERSHIP', 403, "Cette session n'est pas la vôtre.");
    }
    await this.sessions.revoke(sessionId);
    this.logger.log({ event: 'auth.session_revoked', userId: current.id, sessionId });
  }

  /** La demande visée par un lien, si le lien est le bon et encore valable ; sinon l'erreur unique. */
  private usablePending(
    pending: PendingRegistrationRow | undefined,
    presentedHash: string,
  ): PendingRegistrationRow {
    if (!pending) throw this.registrationLinkRejected('unknown');
    if (!this.tokens.sameHash(pending.tokenHash, presentedHash)) {
      throw this.registrationLinkRejected('bad_secret');
    }
    if (pending.expiresAt <= new Date()) throw this.registrationLinkRejected('expired');
    return pending;
  }

  /** Une seule erreur pour l'appelant, quelle que soit la raison (elle n'est que dans les logs). */
  private registrationLinkRejected(reason: string): DomainError {
    this.logger.warn({ event: 'auth.registration_link_rejected', reason });
    return new DomainError(
      'REGISTRATION_LINK_INVALID',
      400,
      "Ce lien d'inscription est invalide ou a expiré.",
    );
  }

  private async refreshWithinGrace(
    session: SessionRow | undefined,
    presented: string,
  ): Promise<AuthResult> {
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw sessionExpired();
    // Secret jamais émis pour cette session : simple 401. On ne révoque pas, sinon connaître un
    // identifiant de session suffirait à déconnecter quelqu'un.
    if (!this.tokens.sameHash(session.previousTokenHash, presented)) throw sessionExpired();

    const withinGrace =
      session.rotatedAt !== null && Date.now() - session.rotatedAt.getTime() <= REFRESH_GRACE_MS;
    if (!withinGrace) {
      // Le secret précédent revient après le délai de grâce : vol ou rejeu. On révoque la session.
      await this.sessions.revoke(session.id);
      this.logger.warn({
        event: 'auth.refresh_reuse_detected',
        userId: session.userId,
        sessionId: session.id,
      });
      throw sessionExpired();
    }
    // Nouvel access token seulement : le cookie de refresh du navigateur est déjà le bon.
    const user = await this.activeUser(session.userId);
    await this.sessions.touch(session.id);
    return {
      user: toPublicUser(user),
      accessToken: await this.tokens.signAccessToken(user, session.id),
    };
  }

  /** Expiration glissante (30 jours), plafonnée à la durée de vie absolue de la session. */
  private nextExpiry(session: SessionRow): Date {
    const sliding = Date.now() + this.tokens.refreshTtlMs;
    return new Date(Math.min(sliding, session.createdAt.getTime() + SESSION_MAX_AGE_MS));
  }

  /** Le rôle est relu en base à chaque refresh : un changement de rôle s'applique en ≤ 15 min. */
  private async activeUser(userId: string): Promise<UserRow> {
    const user = await this.users.findById(userId);
    if (!user) throw sessionExpired();
    return user;
  }

  private newSessionValues(userId: string, secret: string, userAgent: string | undefined) {
    return {
      userId,
      refreshTokenHash: this.tokens.hashSecret(secret),
      userAgent: userAgent?.slice(0, USER_AGENT_MAX_LENGTH) ?? null,
      expiresAt: new Date(Date.now() + this.tokens.refreshTtlMs),
    };
  }

  private async issue(user: UserRow, session: SessionRow, secret: string): Promise<AuthResult> {
    return {
      user: toPublicUser(user),
      accessToken: await this.tokens.signAccessToken(user, session.id),
      refreshToken: this.tokens.formatToken(session.id, secret),
    };
  }
}
