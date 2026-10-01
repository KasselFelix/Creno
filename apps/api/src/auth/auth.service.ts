import { Inject, Injectable, Logger } from '@nestjs/common';
import { type DbHandle, sqlState } from '@creno/db';
import type { LoginInput, PublicUser, RegisterInput, Session } from '@creno/shared';
import { DomainError } from '../common/domain-error.js';
import { DB } from '../database/database.module.js';
import { toPublicUser } from '../users/users.mapper.js';
import { type UserRow, UsersRepository } from '../users/users.repository.js';
import type { AuthUser } from './auth.types.js';
import { PasswordHasher } from './password-hasher.js';
import { type SessionRow, SessionsRepository } from './sessions.repository.js';
import { TokensService } from './tokens.service.js';

/** Un ancien refresh token reste accepté ce délai après rotation (refresh simultanés de plusieurs onglets). */
export const REFRESH_GRACE_MS = 10_000;
const USER_AGENT_MAX_LENGTH = 200;

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
  ) {}

  async register(input: RegisterInput, userAgent: string | undefined): Promise<AuthResult> {
    const passwordHash = await this.hasher.hash(input.password);
    const secret = this.tokens.newRefreshSecret();
    try {
      // Utilisateur + première session : les deux ou rien.
      const { user, session } = await this.handle.db.transaction(async (tx) => {
        const user = await this.users.create({ ...input, passwordHash }, tx);
        const session = await this.sessions.create(
          this.newSessionValues(user.id, secret, userAgent),
          tx,
        );
        return { user, session };
      });
      this.logger.log({ event: 'auth.registered', userId: user.id, role: user.role });
      return this.issue(user, session, secret);
    } catch (error) {
      if (sqlState(error) === '23505') {
        throw new DomainError('EMAIL_TAKEN', 409, 'Un compte existe déjà avec cet email.', {
          fieldErrors: { email: ['Un compte existe déjà avec cet email.'] },
        });
      }
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
    const secret = this.tokens.newRefreshSecret();
    const session = await this.sessions.create(this.newSessionValues(user.id, secret, userAgent));
    this.logger.log({ event: 'auth.logged_in', userId: user.id, sessionId: session.id });
    return this.issue(user, session, secret);
  }

  /**
   * Refresh rotatif : le token présenté est échangé contre un nouveau. Un token déjà remplacé
   * (hors délai de grâce) signale un vol ou un rejeu : la session entière est révoquée.
   */
  async refresh(rawToken: unknown): Promise<AuthResult> {
    const parts = this.tokens.parseRefreshToken(rawToken);
    if (!parts) throw sessionExpired();

    const session = await this.sessions.findById(parts.sessionId);
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw sessionExpired();

    const presented = this.tokens.hashSecret(parts.secret);
    if (this.tokens.sameHash(session.refreshTokenHash, presented)) {
      const secret = this.tokens.newRefreshSecret();
      const rotated = await this.sessions.rotate(
        session.id,
        presented,
        this.tokens.hashSecret(secret),
        new Date(Date.now() + this.tokens.refreshTtlMs),
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

  async logout(current: AuthUser): Promise<void> {
    await this.sessions.revoke(current.sessionId);
    this.logger.log({ event: 'auth.logged_out', userId: current.id, sessionId: current.sessionId });
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

  private async refreshWithinGrace(
    session: SessionRow | undefined,
    presented: string,
  ): Promise<AuthResult> {
    if (!session || session.revokedAt) throw sessionExpired();
    const withinGrace =
      this.tokens.sameHash(session.previousTokenHash, presented) &&
      session.rotatedAt !== null &&
      Date.now() - session.rotatedAt.getTime() <= REFRESH_GRACE_MS;

    if (!withinGrace) {
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
      refreshToken: this.tokens.formatRefreshToken(session.id, secret),
    };
  }
}
