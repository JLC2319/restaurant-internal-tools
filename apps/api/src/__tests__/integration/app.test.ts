import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../app';

/**
 * Wiring smoke tests: routes are mounted, middleware runs in the right order,
 * and errors come back in the documented shape.
 *
 * Deliberately no database. Every case here is answered before a query is
 * issued, so these run anywhere — including where `mongodb-memory-server`
 * cannot fetch its binary. Feature tests that need real data belong in their
 * own file with a `MongoMemoryServer` in `beforeAll`.
 */
describe('app wiring', () => {
  it('answers the health check', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'rit-api' });
  });

  it('returns a JSON 404 for an unknown route', async () => {
    const response = await request(app).get('/api/nope');
    expect(response.status).toBe(404);
    expect(response.body.message).toContain('/api/nope');
  });

  it('sets helmet security headers', async () => {
    const response = await request(app).get('/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  // The scope headers are custom, so preflight has to advertise them or the
  // browser strips them and every tenant route 400s.
  it('advertises the tenant scope headers on preflight', async () => {
    const response = await request(app)
      .options('/api/tenancy/tree')
      .set('Origin', 'http://localhost:4321')
      .set('Access-Control-Request-Method', 'GET');

    const allowed = String(response.headers['access-control-allow-headers']).toLowerCase();
    expect(allowed).toContain('x-org-id');
    expect(allowed).toContain('x-property-id');
    expect(allowed).toContain('x-location-id');
  });
});

describe('validation', () => {
  it('rejects a malformed login body with field-level errors', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: '' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'email' })])
    );
  });

  it('rejects a password below the length floor', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        name: { first: 'Cade', last: 'Ferguson' },
        email: 'cade@example.com',
        password: 'short',
      });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'password' })])
    );
  });
});

describe('auth guard', () => {
  it('rejects a protected route with no token', async () => {
    const response = await request(app).get('/api/auth/me');
    expect(response.status).toBe(401);
  });

  it('rejects a tenant route with no token', async () => {
    const response = await request(app).get('/api/tenancy/tree').set('X-Org-Id', 'anything');
    expect(response.status).toBe(401);
  });

  // authenticate must run *before* resolveTenant: a caller with no token should
  // learn nothing about whether their org header was even well-formed.
  it('reports the missing token, not the missing scope, when both are absent', async () => {
    const response = await request(app).get('/api/tenancy/tree');
    expect(response.status).toBe(401);
    expect(response.body.message).not.toContain('x-org-id');
  });

  it('rejects a token that is present but not verifiable', async () => {
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not.a.real.token');
    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid or expired token');
  });
});
