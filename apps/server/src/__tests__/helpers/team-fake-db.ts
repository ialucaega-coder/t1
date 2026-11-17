/**
 * Prisma en memoria para los tests del flujo de invitaciones al equipo.
 *
 * Soporta solo lo que usan `services/team/invitations.ts`, `routes/team.ts` y el
 * canje de `routes/auth.ts`. `$transaction` toma una foto del estado y la RESTAURA si
 * el callback lanza, así los tests comprueban atomicidad real (un canje que falla no
 * deja usuarios ni tokens quemados a medias). Los JSON de `Connection.config` se
 * serializan al escribir, como en la base: lo que ves en `dump()` es lo que
 * persistiría.
 */
import { vi } from 'vitest';

type Row = Record<string, any>;

let seq = 0;
const nextId = (prefix: string) => `${prefix}_${++seq}`;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'businessId_email') {
      return row.businessId === cond.businessId && row.email === cond.email;
    }
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('not' in cond) return row[key] !== cond.not;
      return true;
    }
    return row[key] === cond;
  });
}

function pick(row: Row | undefined, select?: Row): Row | null {
  if (!row) return null;
  if (!select) return { ...row };
  const out: Row = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
  return out;
}

export function createFakeDb() {
  const state = {
    connections: [] as Row[],
    teamMembers: [] as Row[],
    users: [] as Row[],
    businesses: [] as Row[],
  };

  // Como en la base: el JSON de config se serializa al escribir.
  const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  const db: any = {
    state,

    reset() {
      state.connections = [];
      state.teamMembers = [];
      state.users = [];
      state.businesses = [];
    },

    seedBusiness(id: string, name = `Negocio ${id}`) {
      const row = { id, name, slug: `${id}-slug` };
      state.businesses.push(row);
      return row;
    },
    seedUser(data: Row) {
      const row = {
        id: nextId('user'),
        name: 'Usuario',
        passwordHash: 'hash',
        role: 'CLIENT',
        isActive: true,
        deletedAt: null,
        failedLogins: 0,
        lockedUntil: null,
        ...data,
      };
      state.users.push(row);
      return row;
    },
    seedMember(data: Row) {
      const row = {
        id: nextId('member'),
        name: 'Miembro',
        role: 'VIEWER',
        status: 'PENDING',
        joinedAt: new Date(),
        ...data,
      };
      state.teamMembers.push(row);
      return row;
    },

    /** Todo lo persistido, serializado (para afirmar que un secreto NO está en claro). */
    dump(): string {
      return JSON.stringify(state);
    },
    invitesConfig(businessId: string): any {
      return state.connections.find((c) => c.businessId === businessId && c.type === 'TEAM_INVITES')?.config;
    },

    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (cb: (tx: any) => Promise<unknown>) => {
      const snapshot = structuredClone(state);
      try {
        return await cb(db);
      } catch (err) {
        Object.assign(state, snapshot);
        throw err;
      }
    }),

    connection: {
      findFirst: vi.fn(async ({ where, select }: Row) => pick(state.connections.find((c) => matches(c, where)), select)),
      findUnique: vi.fn(async ({ where, select }: Row) => pick(state.connections.find((c) => matches(c, where)), select)),
      create: vi.fn(async ({ data, select }: Row) => {
        const row = { id: nextId('conn'), ...data, config: clone(data.config) };
        state.connections.push(row);
        return pick(row, select);
      }),
      update: vi.fn(async ({ where, data }: Row) => {
        const row = state.connections.find((c) => c.id === where.id)!;
        Object.assign(row, data, data.config !== undefined ? { config: clone(data.config) } : {});
        return { ...row };
      }),
    },

    teamMember: {
      findMany: vi.fn(async ({ where }: Row = {}) => state.teamMembers.filter((m) => matches(m, where)).map((m) => ({ ...m }))),
      findUnique: vi.fn(async ({ where }: Row) => pick(state.teamMembers.find((m) => matches(m, where)))),
      findFirst: vi.fn(async ({ where }: Row) => pick(state.teamMembers.find((m) => matches(m, where)))),
      create: vi.fn(async ({ data }: Row) => {
        if (state.teamMembers.some((m) => m.businessId === data.businessId && m.email === data.email)) {
          throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
        }
        const row = { id: nextId('member'), avatar: null, status: 'PENDING', joinedAt: new Date(), ...data };
        state.teamMembers.push(row);
        return { ...row };
      }),
      updateMany: vi.fn(async ({ where, data }: Row) => {
        const rows = state.teamMembers.filter((m) => matches(m, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      }),
      deleteMany: vi.fn(async ({ where }: Row) => {
        const before = state.teamMembers.length;
        state.teamMembers = state.teamMembers.filter((m) => !matches(m, where));
        return { count: before - state.teamMembers.length };
      }),
    },

    user: {
      findUnique: vi.fn(async ({ where }: Row) => pick(state.users.find((u) => matches(u, where)))),
      count: vi.fn(async ({ where }: Row) => state.users.filter((u) => matches(u, where)).length),
      create: vi.fn(async ({ data, select }: Row) => {
        if (state.users.some((u) => u.email === data.email)) {
          throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
        }
        const row = {
          id: nextId('user'),
          isActive: true,
          deletedAt: null,
          failedLogins: 0,
          lockedUntil: null,
          ...data,
        };
        state.users.push(row);
        return pick(row, select);
      }),
      update: vi.fn(async ({ where, data, select }: Row) => {
        const row = state.users.find((u) => u.id === where.id)!;
        Object.assign(row, data);
        return pick(row, select);
      }),
    },

    business: {
      findUnique: vi.fn(async ({ where, select }: Row) => pick(state.businesses.find((b) => matches(b, where)), select)),
    },
  };

  return db;
}

export type FakeDb = ReturnType<typeof createFakeDb>;
