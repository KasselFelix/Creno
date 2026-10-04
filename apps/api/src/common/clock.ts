import { Global, Module } from '@nestjs/common';

/** Jeton de l'horloge : les tests la remplacent pour avancer le temps sans attendre. */
export const CLOCK = Symbol('CLOCK');

/** Temps qui passe : instant courant et attente. */
export interface Clock {
  /** Instant courant, en millisecondes depuis l'époque Unix. */
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

@Global()
@Module({ providers: [{ provide: CLOCK, useValue: systemClock }], exports: [CLOCK] })
export class ClockModule {}
