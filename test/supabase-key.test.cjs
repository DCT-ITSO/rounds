const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isServiceRoleKey } = require('../scripts/supabase-key.cjs');

test('service-role key guard rejects secret and legacy service-role keys', () => {
  const payload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');

  assert.equal(isServiceRoleKey('sb_secret_do-not-use-in-client'), true);
  assert.equal(isServiceRoleKey(`header.${payload}.signature`), true);
  assert.equal(isServiceRoleKey('sb_publishable_example'), false);
  assert.equal(isServiceRoleKey('not-a-jwt'), false);
});
