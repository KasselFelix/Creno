import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss, type Queue } from 'pg-boss';
import type { Database } from '@creno/db';
import { describeError } from '../common/all-exceptions.filter.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';

/** Ce qu'un handler reçoit d'un job : son contenu n'est pas encore validé. */
export interface ReceivedJob {
  id: string;
  data: unknown;
  /** 0 au premier essai. */
  retryCount: number;
}

export type JobHandler = (job: ReceivedJob) => Promise<void>;

export interface JobDefinition {
  /** Nom de la file. */
  name: string;
  /** Reprises, expiration, file morte… (options pg-boss de la file). */
  queue?: Omit<Queue, 'name'>;
  /** Expression cron (UTC) : la file reçoit alors un job à chaque échéance. */
  cron?: string;
  handler: JobHandler;
}

export interface SendJobOptions {
  /** Transaction Drizzle : le job n'existe que si elle est validée. */
  tx?: Database;
}

/**
 * File de jobs dans Postgres (pg-boss, schéma `pgboss`). Les modules de domaine déclarent leurs
 * files avec `register` ; ce service ne connaît aucun métier.
 */
@Injectable()
export class JobsService implements OnApplicationShutdown {
  private readonly logger = new Logger(JobsService.name);
  private readonly boss: PgBoss;
  private readonly handlers = new Map<string, JobHandler>();
  private starting?: Promise<void>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    const workers = config.JOBS_WORKERS_ENABLED;
    this.boss = new PgBoss({
      connectionString: config.DATABASE_URL,
      application_name: 'creno-jobs',
      // Pool séparé de celui de l'API, petit : les jobs ne doivent pas affamer les requêtes HTTP.
      max: 4,
      connectionTimeoutMillis: 5_000,
      // Une instance sans workers ne fait qu'écrire des jobs : ni maintenance, ni tâches planifiées.
      supervise: workers,
      schedule: workers,
    });
    // Sans écouteur, un événement `error` (connexion coupée…) arrêterait le processus.
    this.boss.on('error', (error) => {
      this.logger.error({ event: 'jobs.error', err: describeError(error) });
    });
  }

  /** Démarre pg-boss une seule fois (il installe ou met à jour son schéma), à la première utilisation. */
  private start(): Promise<void> {
    this.starting ??= this.boss.start().then(
      () => {
        this.logger.log({ event: 'jobs.started', workers: this.config.JOBS_WORKERS_ENABLED });
      },
      (error: unknown) => {
        // Base injoignable : l'échec n'est pas gardé en mémoire, l'appel suivant réessaie.
        this.starting = undefined;
        throw error;
      },
    );
    return this.starting;
  }

  /** Crée la file, puis branche son worker et sa planification si cette instance exécute des jobs. */
  async register({ name, queue = {}, cron, handler }: JobDefinition): Promise<void> {
    await this.start();
    await this.boss.createQueue(name, queue);
    // `createQueue` ne touche pas une file existante : ses options suivent le code à chaque démarrage.
    const { policy: _policy, partition: _partition, ...updatable } = queue;
    if (Object.keys(updatable).length > 0) await this.boss.updateQueue(name, updatable);
    this.handlers.set(name, handler);
    if (!this.config.JOBS_WORKERS_ENABLED) return;

    await this.boss.work(name, async ([job]) => {
      if (job) await this.run(name, handler, job);
    });
    if (cron) await this.boss.schedule(name, cron, null, { tz: 'UTC' });
  }

  /** Ajoute un job. Avec `tx`, il est écrit dans cette transaction (outbox transactionnelle). */
  async send(name: string, data: object, { tx }: SendJobOptions = {}): Promise<void> {
    await this.start();
    const id = await this.boss.send(name, data, tx ? { db: fromDrizzle(tx, sql) } : {});
    // Sans job, la ligne qui l'attend ne serait jamais traitée : l'erreur annule la transaction.
    if (!id) throw new Error(`Job non créé dans la file ${name}`);
  }

  /**
   * Exécute tout de suite les jobs en attente d'une file, sans attendre leur échéance ni un worker.
   * Sert aux tests (workers désactivés) : le résultat est le même qu'avec un worker, reprise comprise.
   */
  async runPending(name: string): Promise<number> {
    await this.start();
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`File inconnue : ${name}`);
    const jobs = await this.boss.fetch(name, { batchSize: 50, ignoreStartAfter: true });
    for (const job of jobs) {
      try {
        await this.run(name, handler, job);
        await this.boss.complete(name, job.id);
      } catch (error) {
        await this.boss.fail(name, job.id, { message: describeError(error).message });
      }
    }
    return jobs.length;
  }

  /** Supprime tous les jobs (tests). */
  async clear(): Promise<void> {
    await this.start();
    await this.boss.deleteAllJobs();
  }

  private async run(name: string, handler: JobHandler, job: ReceivedJob): Promise<void> {
    try {
      await handler({ id: job.id, data: job.data, retryCount: job.retryCount });
    } catch (error) {
      // pg-boss rejouera le job selon les reprises de la file ; l'échec définitif est loggué par
      // le handler de la file morte ou, à défaut, visible dans `pgboss.job`.
      this.logger.warn({
        event: 'jobs.failed',
        queue: name,
        jobId: job.id,
        attempt: job.retryCount + 1,
        err: describeError(error),
      });
      // pg-boss enregistre l'erreur dans la sortie du job : on ne lui donne que le message nettoyé
      // (une erreur Drizzle porte les paramètres de la requête).
      throw new Error(describeError(error).message ?? 'Échec du job');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.starting) return;
    // Laisse finir les jobs en cours (10 s au plus) avant de fermer les connexions.
    await this.starting.then(
      () => this.boss.stop({ graceful: true, timeout: 10_000 }),
      () => undefined,
    );
  }
}
