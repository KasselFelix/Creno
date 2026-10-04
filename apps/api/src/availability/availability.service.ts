import { Inject, Injectable, Logger } from '@nestjs/common';
import { type DbHandle, sqlState } from '@creno/db';
import {
  type AvailabilityException,
  BOOKING_HORIZON_DAYS,
  MAX_UPCOMING_EXCEPTIONS,
  type CreateExceptionInput,
  type ExceptionList,
  type ReplaceRulesInput,
  type RulesResponse,
  type SlotsQuery,
  type SlotsResponse,
} from '@creno/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { DomainError } from '../common/domain-error.js';
import { mapPgError } from '../common/pg-errors.js';
import { DB } from '../database/database.module.js';
import type { ResourceRow } from '../resources/resources.repository.js';
import { ResourcesRepository } from '../resources/resources.repository.js';
import { ResourcesService } from '../resources/resources.service.js';
import { AvailabilityRepository, type ExceptionRow } from './availability.repository.js';
import {
  addLocalDays,
  computeSlots,
  type Interval,
  isOfferedSlot,
  isoWeekday,
  localDateOf,
  wallTimeToInstant,
} from './slots.engine.js';

const toException = (row: ExceptionRow): AvailabilityException => ({
  id: row.id,
  start: row.start.toISOString(),
  end: row.end.toISOString(),
  reason: row.reason,
});

/** Créneaux libres d'un prestataire le jour demandé, sur ses ressources éligibles. */
export interface DayAvailability {
  /** Somme des créneaux libres des ressources éligibles. */
  availableSlots: number;
  /** Première ressource éligible (prix croissant, puis identifiant) qui a un créneau libre. */
  availableResourceId: string;
}

function byResource<T extends { resourceId: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.resourceId);
    if (group) group.push(row);
    else groups.set(row.resourceId, [row]);
  }
  return groups;
}

/**
 * Fenêtre qui couvre le jour local `date` dans chacun des fuseaux : ses bornes changent d'un fuseau
 * à l'autre. Le moteur ne garde ensuite que ce qui chevauche les créneaux de chaque ressource.
 */
function dayWindow(date: string, timezones: string[]): Interval {
  const days = [...new Set(timezones)].map((timezone) => ({
    start: wallTimeToInstant(date, '00:00', timezone).getTime(),
    end: wallTimeToInstant(date, '24:00', timezone).getTime(),
  }));
  return {
    start: new Date(Math.min(...days.map((day) => day.start))),
    end: new Date(Math.max(...days.map((day) => day.end))),
  };
}

@Injectable()
export class AvailabilityService {
  private readonly logger = new Logger(AvailabilityService.name);

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly availability: AvailabilityRepository,
    private readonly resources: ResourcesService,
    private readonly resourcesRepository: ResourcesRepository,
  ) {}

  async getRules(current: AuthUser, resourceId: string): Promise<RulesResponse> {
    await this.resources.requireOwned(current, resourceId);
    return { rules: await this.availability.listRules(resourceId) };
  }

  /** Remplace tout l'horaire hebdomadaire d'un coup : l'ancien et le nouveau ne se mélangent jamais. */
  async replaceRules(
    current: AuthUser,
    resourceId: string,
    input: ReplaceRulesInput,
  ): Promise<RulesResponse> {
    await this.resources.requireOwned(current, resourceId);
    try {
      const rules = await this.handle.db.transaction(async (tx) => {
        // Deux enregistrements simultanés attendent chacun leur tour sur le verrou de la ressource.
        await this.resourcesRepository.lock(resourceId, tx);
        await this.availability.replaceRules(resourceId, input.rules, tx);
        return this.availability.listRules(resourceId, tx);
      });
      this.logger.log({ event: 'availability.rules_replaced', resourceId, rules: rules.length });
      return { rules };
    } catch (error) {
      // Ici, 23P01 vient de `availability_rules_no_overlap`, pas d'un créneau déjà réservé.
      if (sqlState(error) === '23P01') {
        throw new DomainError('VALIDATION_FAILED', 400, 'Des plages horaires se chevauchent.');
      }
      throw mapPgError(error) ?? error;
    }
  }

  async listExceptions(current: AuthUser, resourceId: string): Promise<ExceptionList> {
    await this.resources.requireOwned(current, resourceId);
    const rows = await this.availability.listExceptions(resourceId, new Date());
    return { items: rows.map(toException) };
  }

  /** Les bornes sont saisies en heure locale : la conversion se fait ici, dans le fuseau de la ressource. */
  async createException(
    current: AuthUser,
    resourceId: string,
    input: CreateExceptionInput,
  ): Promise<AvailabilityException> {
    const resource = await this.resources.requireOwned(current, resourceId);
    const toInstant = (local: string) =>
      wallTimeToInstant(local.slice(0, 10), local.slice(11), resource.timezone);
    const interval = { start: toInstant(input.startLocal), end: toInstant(input.endLocal) };
    // Deux heures locales distinctes peuvent donner le même instant autour d'un changement d'heure.
    if (interval.start >= interval.end) {
      throw new DomainError('VALIDATION_FAILED', 400, 'Données invalides.', {
        formErrors: [],
        fieldErrors: { endLocal: ['La fin doit être après le début'] },
      });
    }
    try {
      const row = await this.handle.db.transaction(async (tx) => {
        // Verrou + comptage + insertion dans la même transaction : la limite tient même en parallèle.
        await this.resourcesRepository.lock(resourceId, tx);
        if (
          (await this.availability.countUpcomingExceptions(resourceId, tx)) >=
          MAX_UPCOMING_EXCEPTIONS
        ) {
          throw new DomainError(
            'LIMIT_REACHED',
            409,
            `${MAX_UPCOMING_EXCEPTIONS} fermetures à venir au plus par ressource.`,
          );
        }
        return this.availability.createException(resourceId, interval, input.reason || null, tx);
      });
      this.logger.log({
        event: 'availability.exception_created',
        resourceId,
        exceptionId: row.id,
      });
      return toException(row);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw mapPgError(error) ?? error;
    }
  }

  async deleteException(current: AuthUser, resourceId: string, exceptionId: string): Promise<void> {
    await this.resources.requireOwned(current, resourceId);
    if (!(await this.availability.deleteException(resourceId, exceptionId))) {
      throw new DomainError('NOT_FOUND', 404, 'Fermeture introuvable.');
    }
    this.logger.log({ event: 'availability.exception_deleted', resourceId, exceptionId });
  }

  /**
   * Créneaux de la ressource entre deux dates locales. Trois requêtes quel que soit le nombre de
   * jours (règles, fermetures, réservations), puis le calcul en mémoire par le moteur.
   */
  async getSlots(resourceId: string, query: SlotsQuery, now = new Date()): Promise<SlotsResponse> {
    const resource = await this.resources.requireActive(resourceId);
    const window = {
      start: wallTimeToInstant(query.from, '00:00', resource.timezone),
      end: wallTimeToInstant(query.to, '24:00', resource.timezone),
    };
    const [rules, closures, busy] = await Promise.all([
      this.availability.listRules(resourceId),
      this.availability.closuresBetween(resourceId, window),
      this.availability.busyBetween(resourceId, window),
    ]);
    const days = computeSlots({
      timezone: resource.timezone,
      slotMinutes: resource.slotMinutes,
      rules,
      closures,
      busy,
      from: query.from,
      to: query.to,
      now,
      horizonDays: BOOKING_HORIZON_DAYS,
    });
    return {
      resourceId,
      timezone: resource.timezone,
      slotMinutes: resource.slotMinutes,
      priceCents: resource.priceCents,
      currency: resource.currency,
      days: days.map((day) => ({
        date: day.date,
        slots: day.slots.map((slot) => ({
          start: slot.start.toISOString(),
          end: slot.end.toISOString(),
          available: slot.available,
        })),
      })),
    };
  }

  /**
   * Créneaux libres de chaque prestataire le jour `date` (date locale de chaque ressource), pour le
   * filtre « disponible le » de la recherche. Même calcul que `getSlots`, par le moteur, mais chargé
   * par lot : une requête pour les ressources, puis trois pour toutes à la fois (règles, fermetures,
   * réservations), quel que soit leur nombre. Avec `priceMaxCents`, seules les ressources à ce prix
   * ou moins comptent. Seuls les prestataires qui ont au moins un créneau libre sont renvoyés.
   */
  async freeSlotsOn(
    providerIds: string[],
    date: string,
    { priceMaxCents }: { priceMaxCents?: number },
    now = new Date(),
  ): Promise<Map<string, DayAvailability>> {
    const result = new Map<string, DayAvailability>();
    const resources = await this.availability.activeResourcesOf(providerIds, priceMaxCents);
    if (resources.length === 0) return result;

    const ids = resources.map((resource) => resource.id);
    const window = dayWindow(
      date,
      resources.map((resource) => resource.timezone),
    );
    const [rules, closures, busy] = await Promise.all([
      this.availability.rulesOn(ids, isoWeekday(date)),
      this.availability.closuresOf(ids, window),
      this.availability.busyOf(ids, window),
    ]);
    const rulesOf = byResource(rules);
    const closuresOf = byResource(closures);
    const busyOf = byResource(busy);

    for (const resource of resources) {
      const [day] = computeSlots({
        timezone: resource.timezone,
        slotMinutes: resource.slotMinutes,
        rules: rulesOf.get(resource.id) ?? [],
        closures: closuresOf.get(resource.id) ?? [],
        busy: busyOf.get(resource.id) ?? [],
        from: date,
        to: date,
        now,
        horizonDays: BOOKING_HORIZON_DAYS,
      });
      const free = day?.slots.filter((slot) => slot.available).length ?? 0;
      if (free === 0) continue;
      const current = result.get(resource.providerId);
      // Les ressources arrivent par prix croissant : la première qui a un créneau libre sert au lien.
      if (current) current.availableSlots += free;
      else
        result.set(resource.providerId, { availableSlots: free, availableResourceId: resource.id });
    }
    return result;
  }

  /**
   * Vrai si `start` est un début de créneau proposé par la ressource (horaires, fermetures, passé,
   * horizon). Les réservations sont ignorées : c'est la contrainte de la base qui tranche.
   */
  async isOffered(resource: ResourceRow, start: Date, now = new Date()): Promise<boolean> {
    const date = localDateOf(start, resource.timezone);
    const window = {
      start: wallTimeToInstant(date, '00:00', resource.timezone),
      end: wallTimeToInstant(addLocalDays(date, 1), '00:00', resource.timezone),
    };
    const [rules, closures] = await Promise.all([
      this.availability.listRules(resource.id),
      this.availability.closuresBetween(resource.id, window),
    ]);
    return isOfferedSlot(
      {
        timezone: resource.timezone,
        slotMinutes: resource.slotMinutes,
        rules,
        closures,
        busy: [],
        now,
        horizonDays: BOOKING_HORIZON_DAYS,
      },
      start,
    );
  }
}
