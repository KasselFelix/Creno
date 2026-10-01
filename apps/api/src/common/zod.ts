import { type ArgumentMetadata, applyDecorators, type PipeTransform } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { z } from 'zod';
import { DomainError } from './domain-error.js';

/**
 * Valide une entrée avec un schéma Zod de `@creno/shared` (le même que le front).
 * Erreur → 400 VALIDATION_FAILED avec le détail par champ.
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown, _metadata: ArgumentMetadata): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new DomainError(
        'VALIDATION_FAILED',
        400,
        'Données invalides.',
        z.flattenError(result.error),
      );
    }
    return result.data;
  }
}

type SwaggerSchema = NonNullable<
  Extract<Parameters<typeof ApiBody>[0], { schema?: unknown }>['schema']
>;

/** Documente le corps attendu dans Swagger à partir du schéma Zod. */
export function ApiZodBody(schema: z.ZodType) {
  return applyDecorators(
    ApiBody({
      schema: z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as SwaggerSchema,
    }),
  );
}
