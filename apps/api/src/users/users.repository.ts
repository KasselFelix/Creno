import { Inject, Injectable } from '@nestjs/common';
import { asc, count, eq } from 'drizzle-orm';
import { type Database, type DbHandle, users } from '@creno/db';
import type { Pagination, UserRole } from '@creno/shared';
import { DB } from '../database/database.module.js';

export type UserRow = typeof users.$inferSelect;

@Injectable()
export class UsersRepository {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async findById(id: string): Promise<UserRow | undefined> {
    return this.handle.db.query.users.findFirst({ where: eq(users.id, id) });
  }

  /** L'email est en `citext` : la recherche est insensible à la casse. */
  async findByEmail(email: string): Promise<UserRow | undefined> {
    return this.handle.db.query.users.findFirst({ where: eq(users.email, email) });
  }

  async create(
    values: {
      email: string;
      fullName: string;
      role: UserRole;
      passwordHash: string;
      emailVerifiedAt: Date;
    },
    tx: Database = this.handle.db,
  ): Promise<UserRow> {
    const [row] = await tx.insert(users).values(values).returning();
    return row!;
  }

  async update(
    id: string,
    values: { fullName?: string; phone?: string | null },
  ): Promise<UserRow | undefined> {
    const [row] = await this.handle.db
      .update(users)
      .set(values)
      .where(eq(users.id, id))
      .returning();
    return row;
  }

  async list({ page, pageSize }: Pagination): Promise<{ rows: UserRow[]; total: number }> {
    const [rows, [totals]] = await Promise.all([
      this.handle.db
        .select()
        .from(users)
        .orderBy(asc(users.createdAt), asc(users.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.handle.db.select({ total: count() }).from(users),
    ]);
    return { rows, total: totals?.total ?? 0 };
  }
}
