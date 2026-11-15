import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace(/^Bearer\s+/i, '');
  if (!accessToken) return reply({ error: 'Sign in as an Admin first.' }, 401);

  const projectUrl = Deno.env.get('SUPABASE_URL') || '';
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!projectUrl || !publicKey || !serviceKey) return reply({ error: 'Function secrets are not configured.' }, 500);

  const callerClient = createClient(projectUrl, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
  const { data: authData, error: authError } = await callerClient.auth.getUser(accessToken);
  if (authError || !authData.user) return reply({ error: 'Your sign-in session is invalid or expired.' }, 401);

  const { data: profile, error: profileError } = await callerClient
    .from('profiles')
    .select('role,is_active')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (profileError) return reply({ error: 'Could not verify the Rounds account role.' }, 403);
  if (!profile || profile.role !== 'admin' || !profile.is_active) {
    return reply({ error: 'Only an active Admin can create IT Staff accounts.' }, 403);
  }

  let body: { full_name?: string; email?: string; password?: string };
  try { body = await request.json(); }
  catch { return reply({ error: 'Request body must be valid JSON.' }, 400); }

  const fullName = String(body.full_name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
    return reply({ error: 'Enter a name, valid email, and password with at least 8 characters.' }, 400);
  }

  const adminClient = createClient(projectUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName }
  });
  if (error) return reply({ error: error.message }, 400);

  await adminClient.from('activity_log').insert({
    actor_id: authData.user.id,
    action: 'staff_created',
    entity_type: 'staff',
    entity_id: data.user.id,
    details: { name: fullName }
  });

  return reply({ user: { id: data.user.id, name: fullName, email, role: 'staff', active: true } }, 201);

  function reply(payload: unknown, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
