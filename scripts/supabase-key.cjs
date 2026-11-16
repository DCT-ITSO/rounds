function isServiceRoleKey(key) {
  if (/^sb_secret_/i.test(key)) return true;
  const payload = String(key || '').split('.')[1];
  if (!payload) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role === 'service_role';
  } catch {
    return false;
  }
}

module.exports = { isServiceRoleKey };
