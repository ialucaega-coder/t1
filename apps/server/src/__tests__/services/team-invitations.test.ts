/**
 * Servicio de invitaciones al equipo (`services/team/invitations.ts`): token de un
 * solo uso guardado SOLO como hash, vencimiento a 7 días, canje atómico que crea el
 * usuario con el rol del miembro. Prisma en memoria (helpers/team-fake-db).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', async () => {
  const { createFakeDb } = await import('../helpers/team-fake-db');
  return { prisma: createFakeDb() };
});

import { prisma } from '../../lib/prisma';
import type { FakeDb } from '../helpers/team-fake-db';
import {
  INVITE_TTL_MS,
  InviteError,
  acceptInvite,
  hashInviteToken,
  isInviteTokenLive,
  issueInviteTx,
  listInviteExpiries,
  parseInviteToken,
  revokeInviteTx,
  teamRoleToUserRole,
} from '../../services/team/invitations';

const db = prisma as unknown as FakeDb;
const DAY = 24 * 60 * 60 * 1000;

async function issue(businessId: string, memberId: string, email: string, now?: number) {
  return db.$transaction((tx: any) => issueInviteTx(tx, businessId, memberId, email, now));
}

async function reasonOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    if (err instanceof InviteError) return err.reason;
    throw err;
  }
}

function seedPending(role = 'PROFESSIONAL', businessId = 'biz_1', email = 'nueva@example.com') {
  const member = db.seedMember({ businessId, email, role, name: 'nueva' });
  return member;
}

beforeEach(() => {
  db.reset();
  db.seedBusiness('biz_1');
  db.seedBusiness('biz_2');
});

describe('services/team/invitations', () => {
  describe('almacenamiento del token', () => {
    it('guarda solo el hash SHA-256 (nunca el token en claro), con email, miembro y vencimiento a 7 días', async () => {
      const member = seedPending();
      const now = Date.parse('2026-11-15T12:00:00Z');
      const { token, expiresAt } = await issue('biz_1', member.id, 'Nueva@Example.com', now);

      expect(db.dump()).not.toContain(token);
      const secret = token.split('.')[1];
      expect(db.dump()).not.toContain(secret);

      const stored = db.invitesConfig('biz_1').invites[member.id];
      expect(stored.tokenHash).toBe(hashInviteToken(token));
      expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.email).toBe('nueva@example.com');
      expect(Date.parse(stored.expiresAt)).toBe(now + INVITE_TTL_MS);
      expect(expiresAt.getTime()).toBe(now + 7 * DAY);
    });

    it('cada invitación genera un token distinto con la forma <negocio>.<secreto>', async () => {
      const a = seedPending('VIEWER', 'biz_1', 'a@example.com');
      const b = seedPending('VIEWER', 'biz_1', 'b@example.com');
      const ta = (await issue('biz_1', a.id, 'a@example.com')).token;
      const tb = (await issue('biz_1', b.id, 'b@example.com')).token;
      expect(ta).not.toBe(tb);
      expect(parseInviteToken(ta)).toEqual({ businessId: 'biz_1' });
    });

    it('listInviteExpiries expone vencimientos pero nunca hashes', async () => {
      const member = seedPending();
      await issue('biz_1', member.id, 'nueva@example.com');
      const expiries = await listInviteExpiries('biz_1');
      expect(Object.keys(expiries)).toEqual([member.id]);
      expect(JSON.stringify(expiries)).not.toMatch(/[0-9a-f]{64}/);
      expect(await listInviteExpiries('biz_2')).toEqual({});
    });
  });

  describe('canje (acceptInvite)', () => {
    it('token válido: crea el User con el rol del miembro, activa al miembro y quema el token', async () => {
      const member = seedPending('PROFESSIONAL');
      const { token } = await issue('biz_1', member.id, 'nueva@example.com');

      const res = await acceptInvite({ token, name: 'Ana Pérez', passwordHash: 'argon-hash' });

      expect(res.user).toMatchObject({ email: 'nueva@example.com', name: 'Ana Pérez', role: 'PROFESSIONAL' });
      expect(res.business).toMatchObject({ id: 'biz_1' });
      const user = db.state.users.find((u: any) => u.email === 'nueva@example.com');
      expect(user).toMatchObject({ businessId: 'biz_1', passwordHash: 'argon-hash', role: 'PROFESSIONAL' });
      const m = db.state.teamMembers.find((x: any) => x.id === member.id);
      expect(m).toMatchObject({ status: 'ACTIVE', name: 'Ana Pérez' });
      expect(db.invitesConfig('biz_1').invites[member.id]).toBeUndefined();
    });

    it.each([
      ['ADMIN', 'ADMIN'],
      ['PROFESSIONAL', 'PROFESSIONAL'],
      ['VIEWER', 'CLIENT'],
    ])('rol de miembro %s -> rol de login %s', async (memberRole, userRole) => {
      const member = seedPending(memberRole);
      const { token } = await issue('biz_1', member.id, 'nueva@example.com');
      const res = await acceptInvite({ token, name: 'Ana', passwordHash: 'h' });
      expect(res.user.role).toBe(userRole);
      expect(teamRoleToUserRole(memberRole)).toBe(userRole);
    });

    it('el rol se lee al canjear: un cambio de rol entre la invitación y el canje se respeta', async () => {
      const member = seedPending('ADMIN');
      const { token } = await issue('biz_1', member.id, 'nueva@example.com');
      db.state.teamMembers.find((m: any) => m.id === member.id).role = 'VIEWER';

      const res = await acceptInvite({ token, name: 'Ana', passwordHash: 'h' });
      expect(res.user.role).toBe('CLIENT');
    });

    it('un token ya usado falla (un solo uso) y no crea otro usuario', async () => {
      const member = seedPending();
      const { token } = await issue('biz_1', member.id, 'nueva@example.com');
      await acceptInvite({ token, name: 'Ana', passwordHash: 'h' });

      expect(await reasonOf(acceptInvite({ token, name: 'Otra', passwordHash: 'h2' }))).toBe('INVALID');
      expect(db.state.users).toHaveLength(1);
    });

    it('un token vencido falla y no deja nada a medias', async () => {
      const member = seedPending();
      const issuedAt = Date.now() - 8 * DAY;
      const { token } = await issue('biz_1', member.id, 'nueva@example.com', issuedAt);

      expect(await reasonOf(acceptInvite({ token, name: 'Ana', passwordHash: 'h' }))).toBe('EXPIRED');
      expect(db.state.users).toHaveLength(0);
      expect(db.state.teamMembers.find((m: any) => m.id === member.id).status).toBe('PENDING');
    });

    it('justo antes de los 7 días todavía sirve; al cumplirlos, no', async () => {
      const member = seedPending();
      const t0 = Date.parse('2026-11-01T00:00:00Z');
      const { token } = await issue('biz_1', member.id, 'nueva@example.com', t0);

      expect(await reasonOf(acceptInvite({ token, name: 'Ana', passwordHash: 'h', now: t0 + INVITE_TTL_MS }))).toBe('EXPIRED');
      expect(await reasonOf(acceptInvite({ token, name: 'Ana', passwordHash: 'h', now: t0 + INVITE_TTL_MS - 1 }))).toBeNull();
    });

    it('un token con el secreto de otro negocio (prefijo cambiado) falla', async () => {
      const m1 = seedPending('ADMIN', 'biz_1', 'uno@example.com');
      const { token } = await issue('biz_1', m1.id, 'uno@example.com');
      const secret = token.split('.')[1];

      expect(await reasonOf(acceptInvite({ token: `biz_2.${secret}`, name: 'X', passwordHash: 'h' }))).toBe('INVALID');
      expect(db.state.users).toHaveLength(0);
    });

    it('el token de un negocio no activa a un miembro de otro negocio (multi-tenant)', async () => {
      // La invitación quedó apuntando a un miembro que NO pertenece a biz_1.
      const foreign = db.seedMember({ businessId: 'biz_2', email: 'ajeno@example.com', role: 'ADMIN' });
      const { token } = await issue('biz_1', foreign.id, 'ajeno@example.com');

      expect(await reasonOf(acceptInvite({ token, name: 'X', passwordHash: 'h' }))).toBe('INVALID');
      expect(db.state.users).toHaveLength(0);
      expect(db.state.teamMembers.find((m: any) => m.id === foreign.id).status).toBe('PENDING');
    });

    it('el token de un miembro no sirve si el email del miembro cambió', async () => {
      const member = seedPending('ADMIN', 'biz_1', 'uno@example.com');
      const { token } = await issue('biz_1', member.id, 'uno@example.com');
      db.state.teamMembers.find((m: any) => m.id === member.id).email = 'otro@example.com';

      expect(await reasonOf(acceptInvite({ token, name: 'X', passwordHash: 'h' }))).toBe('INVALID');
      expect(db.state.users).toHaveLength(0);
    });

    it('reenviar (nuevo token) invalida el anterior', async () => {
      const member = seedPending();
      const first = await issue('biz_1', member.id, 'nueva@example.com');
      const second = await issue('biz_1', member.id, 'nueva@example.com');

      expect(await reasonOf(acceptInvite({ token: first.token, name: 'Ana', passwordHash: 'h' }))).toBe('INVALID');
      expect(await reasonOf(acceptInvite({ token: second.token, name: 'Ana', passwordHash: 'h' }))).toBeNull();
    });

    it('revocar la invitación deja el token inservible', async () => {
      const member = seedPending();
      const { token } = await issue('biz_1', member.id, 'nueva@example.com');
      expect(await db.$transaction((tx: any) => revokeInviteTx(tx, 'biz_1', member.id))).toBe(true);
      expect(await db.$transaction((tx: any) => revokeInviteTx(tx, 'biz_1', member.id))).toBe(false);

      expect(await reasonOf(acceptInvite({ token, name: 'Ana', passwordHash: 'h' }))).toBe('INVALID');
    });

    it('si el email ya tiene cuenta en OTRO negocio: conflicto, sin tocar nada y sin quemar el token', async () => {
      const member = seedPending();
      db.seedUser({ email: 'nueva@example.com', businessId: 'biz_2', role: 'ADMIN' });
      const { token } = await issue('biz_1', member.id, 'nueva@example.com');

      expect(await reasonOf(acceptInvite({ token, name: 'Ana', passwordHash: 'h' }))).toBe('CONFLICT');
      expect(db.state.users).toHaveLength(1);
      expect(db.state.users[0]).toMatchObject({ businessId: 'biz_2', role: 'ADMIN', passwordHash: 'hash' });
      expect(db.state.teamMembers.find((m: any) => m.id === member.id).status).toBe('PENDING');
      expect(db.invitesConfig('biz_1').invites[member.id]).toBeDefined();
    });

    it('nunca pisa una cuenta ACTIVA del mismo negocio (no hay toma de cuenta por invitación)', async () => {
      const member = seedPending('ADMIN');
      db.seedUser({ email: 'nueva@example.com', businessId: 'biz_1', role: 'CLIENT', isActive: true });
      const { token } = await issue('biz_1', member.id, 'nueva@example.com');

      expect(await reasonOf(acceptInvite({ token, name: 'Ana', passwordHash: 'nuevo' }))).toBe('CONFLICT');
      expect(db.state.users[0]).toMatchObject({ role: 'CLIENT', passwordHash: 'hash' });
    });

    it('reactiva una cuenta dada de baja del MISMO negocio (re-invitar a alguien que fue quitado)', async () => {
      const member = seedPending('PROFESSIONAL');
      db.seedUser({
        email: 'nueva@example.com',
        businessId: 'biz_1',
        role: 'CLIENT',
        isActive: false,
        failedLogins: 4,
        lockedUntil: new Date(Date.now() + 60_000),
      });
      const { token } = await issue('biz_1', member.id, 'nueva@example.com');

      const res = await acceptInvite({ token, name: 'Ana', passwordHash: 'nuevo' });
      expect(res.user.role).toBe('PROFESSIONAL');
      expect(db.state.users).toHaveLength(1);
      expect(db.state.users[0]).toMatchObject({
        isActive: true,
        passwordHash: 'nuevo',
        failedLogins: 0,
        lockedUntil: null,
      });
    });

    it('HIGH-1: al reactivar, el 2FA queda desactivado y los códigos de recuperación viejos se borran', async () => {
      const member = seedPending('PROFESSIONAL');
      db.seedUser({
        id: 'ex',
        email: 'nueva@example.com',
        businessId: 'biz_1',
        isActive: false,
        twoFactorEnabled: true,
        twoFactorSecret: 'secreto-cifrado',
      });
      db.seedUser({ id: 'otro', email: 'otro@example.com', businessId: 'biz_1', twoFactorEnabled: true, twoFactorSecret: 's2' });
      db.state.connections.push({
        id: 'rec_1',
        businessId: 'biz_1',
        type: 'TWO_FACTOR_RECOVERY',
        config: { codes: { ex: ['hash1', 'hash2'], otro: ['hashX'] } },
      });
      const { token } = await issue('biz_1', member.id, 'nueva@example.com');

      await acceptInvite({ token, name: 'Ana', passwordHash: 'nuevo' });

      const ex = db.state.users.find((u: any) => u.id === 'ex');
      expect(ex).toMatchObject({ isActive: true, twoFactorEnabled: false, twoFactorSecret: null, passwordHash: 'nuevo' });
      const rec = db.state.connections.find((c: any) => c.id === 'rec_1');
      expect(rec.config.codes.ex).toBeUndefined();
      // No toca los códigos ni el 2FA de otros usuarios.
      expect(rec.config.codes.otro).toEqual(['hashX']);
      expect(db.state.users.find((u: any) => u.id === 'otro')).toMatchObject({ twoFactorEnabled: true, twoFactorSecret: 's2' });
    });

    it('HIGH-1: reactivar una cuenta sin códigos guardados no falla', async () => {
      const member = seedPending();
      db.seedUser({ id: 'ex', email: 'nueva@example.com', businessId: 'biz_1', isActive: false, twoFactorEnabled: true, twoFactorSecret: 's' });
      const { token } = await issue('biz_1', member.id, 'nueva@example.com');
      await expect(acceptInvite({ token, name: 'Ana', passwordHash: 'n' })).resolves.toBeDefined();
      expect(db.state.users[0]).toMatchObject({ twoFactorEnabled: false, twoFactorSecret: null });
    });

    it('HIGH-1: NO reactiva (ni toca el 2FA de) una cuenta de OTRO negocio', async () => {
      const member = seedPending();
      db.seedUser({
        id: 'ajena',
        email: 'nueva@example.com',
        businessId: 'biz_2',
        isActive: false,
        twoFactorEnabled: true,
        twoFactorSecret: 'secreto',
      });
      db.state.connections.push({ id: 'rec_2', businessId: 'biz_2', type: 'TWO_FACTOR_RECOVERY', config: { codes: { ajena: ['h'] } } });
      const { token } = await issue('biz_1', member.id, 'nueva@example.com');

      expect(await reasonOf(acceptInvite({ token, name: 'Ana', passwordHash: 'n' }))).toBe('CONFLICT');
      expect(db.state.users[0]).toMatchObject({ isActive: false, twoFactorEnabled: true, twoFactorSecret: 'secreto', passwordHash: 'hash' });
      expect(db.state.connections.find((c: any) => c.id === 'rec_2').config.codes.ajena).toEqual(['h']);
    });

    it('HIGH-1: NO reactiva una cuenta con borrado lógico (el 2FA queda igual)', async () => {
      const member = seedPending();
      db.seedUser({ email: 'nueva@example.com', businessId: 'biz_1', isActive: false, deletedAt: new Date(), twoFactorEnabled: true, twoFactorSecret: 's' });
      const { token } = await issue('biz_1', member.id, 'nueva@example.com');
      expect(await reasonOf(acceptInvite({ token, name: 'Ana', passwordHash: 'n' }))).toBe('CONFLICT');
      expect(db.state.users[0]).toMatchObject({ isActive: false, twoFactorEnabled: true, twoFactorSecret: 's' });
    });

    it('MEDIUM-1: el canje toma TEAM_MEMBERS_GUARD ANTES que el lock de invitaciones (mismo orden que el resto)', async () => {
      const member = seedPending();
      const { token } = await issue('biz_1', member.id, 'nueva@example.com');
      db.$executeRaw.mockClear();

      await acceptInvite({ token, name: 'Ana', passwordHash: 'h' });
      const keys = db.$executeRaw.mock.calls.map((c: unknown[]) => c[1]);
      expect(keys[0]).toBe('conn-singleton:TEAM_MEMBERS_GUARD:biz_1');
      expect(keys[1]).toBe('conn-singleton:TEAM_INVITES:biz_1');
    });

    it('no reactiva una cuenta con borrado lógico', async () => {
      const member = seedPending();
      db.seedUser({ email: 'nueva@example.com', businessId: 'biz_1', isActive: false, deletedAt: new Date() });
      const { token } = await issue('biz_1', member.id, 'nueva@example.com');
      expect(await reasonOf(acceptInvite({ token, name: 'Ana', passwordHash: 'h' }))).toBe('CONFLICT');
    });

    it('una carrera con el registro del mismo email (unique de User.email) se resuelve como conflicto', async () => {
      const member = seedPending();
      const { token } = await issue('biz_1', member.id, 'nueva@example.com');
      db.user.findUnique.mockResolvedValueOnce(null);
      db.user.create.mockRejectedValueOnce(Object.assign(new Error('Unique'), { code: 'P2002' }));

      expect(await reasonOf(acceptInvite({ token, name: 'Ana', passwordHash: 'h' }))).toBe('CONFLICT');
      expect(db.state.teamMembers.find((m: any) => m.id === member.id).status).toBe('PENDING');
    });

    it('tokens con forma inválida o gigantes ni siquiera tocan la base', async () => {
      db.connection.findFirst.mockClear();
      for (const bad of ['', 'abc', 'sin-punto', 'a.b', `biz_1.${'x'.repeat(500)}`, 123 as unknown as string, '../etc.passwd']) {
        expect(await reasonOf(acceptInvite({ token: bad, name: 'X', passwordHash: 'h' }))).toBe('INVALID');
      }
      expect(db.connection.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('isInviteTokenLive (chequeo previo, solo lectura)', () => {
    it('true para un token vigente; false para vencido, quemado o inexistente', async () => {
      const member = seedPending();
      const { token } = await issue('biz_1', member.id, 'nueva@example.com');
      expect(await isInviteTokenLive(token)).toBe(true);
      expect(await isInviteTokenLive(token, Date.now() + 8 * DAY)).toBe(false);
      expect(await isInviteTokenLive('biz_1.' + 'a'.repeat(43))).toBe(false);
      expect(await isInviteTokenLive(undefined)).toBe(false);

      await acceptInvite({ token, name: 'Ana', passwordHash: 'h' });
      expect(await isInviteTokenLive(token)).toBe(false);
    });
  });
});
