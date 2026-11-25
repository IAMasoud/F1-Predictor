// Join the team: the public side of an admin invite (the /join page).
//   ?action=check   { token }                      → the invite's role, or why it can't be used
//   ?action=upload  { token, name, type, size }    → a one-time upload slot for the CV
//   ?action=apply   { token, ...details }          → saves the application
// Applying makes the sign-in account from their email and password, blocked until the owner
// accepts it in Pit Wall → Members. Each invite link takes one application.
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SITE = 'https://pitwall.company';
const ORIGINS = [SITE, 'https://www.pitwall.company', 'https://f1-predictor-theta.vercel.app', 'http://localhost:4321'];
const MAX_CV = 10 * 1024 * 1024;
const CV_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
export const EDUCATION = ['Secondary school', 'Diploma', "Bachelor's", "Master's", 'PhD', 'Other'];

type Json = Record<string, any>;
const headersFor = (origin: string) => ({
  'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : SITE,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
  Vary: 'Origin',
});

async function db(path: string, { method = 'GET', body, prefer }: { method?: string; body?: unknown; prefer?: string } = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status} ${(await r.text()).slice(0, 160)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
async function authAdmin(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}) {
  const r = await fetch(`${SB_URL}/auth/v1/admin/${path}`, {
    method, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e: any = new Error(j.msg || j.message || j.error_description || `Auth error ${r.status}`); e.status = r.status; e.code = j.error_code || j.code; throw e; }
  return j;
}

// Best-effort limit per server instance: 40 requests per 10 minutes per address.
const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now(), recent = (hits.get(ip) || []).filter(t => now - t < 600000);
  recent.push(now); hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 40;
}

async function findInvite(token: unknown) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{30,80}$/.test(token)) return { error: 'This invite link is not complete. Open the whole link you were sent.', status: 400 };
  const row = (await db(`admin_invites?token=eq.${token}&select=id,role,expires_at,used_at,revoked`))?.[0];
  if (!row) return { error: 'This invite link is not valid. Ask for a new one.', status: 404 };
  if (row.revoked) return { error: 'This invite was cancelled. Ask for a new one.', status: 410 };
  if (row.used_at) return { error: 'This invite link was already used to apply.', status: 410 };
  if (Date.parse(row.expires_at) < Date.now()) return { error: 'This invite link has expired. Ask for a new one.', status: 410 };
  return { invite: row };
}

const text = (v: unknown, max: number) => { const s = String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim(); return s ? s.slice(0, max) : null; };
const url = (v: unknown) => { const s = text(v, 200); if (!s) return null; const u = /^https?:\/\//i.test(s) ? s : `https://${s}`; try { const p = new URL(u); return /\./.test(p.hostname) ? p.toString().slice(0, 200) : null; } catch { return null; } };
const int = (v: unknown, lo: number, hi: number) => { const n = parseInt(String(v ?? ''), 10); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

/* Checks the details. Returns { row } for the database, or { error, field }. */
export function validate(b: Json, inviteId: string) {
  const full_name = text(b.full_name, 80);
  if (!full_name || full_name.length < 2) return { error: 'Enter your full name.', field: 'full_name' };
  const dob = String(b.date_of_birth || '');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(dob) ? new Date(`${dob}T00:00:00Z`) : null;
  const age = d && !isNaN(+d) ? (Date.now() - +d) / (365.25 * 864e5) : NaN;
  if (!d || isNaN(age) || age < 13 || age > 100) return { error: 'Enter your date of birth.', field: 'date_of_birth' };
  const email = String(b.email || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@<>"',;]{1,64}@[^\s@<>"',;]+\.[a-z]{2,}$/i.test(email)) return { error: 'Enter a valid email address.', field: 'email' };
  const password = String(b.password || '');
  if (password.length < 10 || password.length > 72) return { error: 'The password needs 10 to 72 characters.', field: 'password' };
  const level = text(b.education_level, 40);
  const cv_path = text(b.cv_path, 200);
  if (cv_path && !new RegExp(`^cv/${inviteId}/[0-9a-f-]{36}\\.(pdf|docx?)$`).test(cv_path)) return { error: 'The CV upload did not finish. Choose the file again.', field: 'cv' };
  return {
    password,
    row: {
      full_name, date_of_birth: dob, email,
      phone: text(b.phone, 30), location: text(b.location, 80),
      education_level: level && EDUCATION.includes(level) ? level : null,
      school: text(b.school, 120), major: text(b.major, 120), graduation_year: int(b.graduation_year, 1950, 2045),
      occupation: text(b.occupation, 120), skills: text(b.skills, 600), languages: text(b.languages, 200),
      interests: text(b.interests, 600), linkedin: url(b.linkedin), website: url(b.website),
      hours_per_week: int(b.hours_per_week, 0, 80), about: text(b.about, 3000),
      cv_path, cv_name: cv_path ? text(String(b.cv_name || '').replace(/[\\/]/g, '_'), 120) : null,
    },
  };
}

async function notifyOwner(name: string, role: string) {
  if (!CRON_SECRET) return;
  await fetch(`${SB_URL}/functions/v1/ops?task=notify`, {
    method: 'POST', headers: { Authorization: `Bearer ${CRON_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `New team application: ${name} wants to join as ${role}.`, link: `${SITE}/admin#members` }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});
}

export async function handle(req: Request): Promise<Response> {
  const origin = req.headers.get('origin') || '';
  const base = headersFor(origin);
  const reply = (body: Json, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...base, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: base });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  if (!ORIGINS.includes(origin)) return reply({ error: 'Forbidden' }, 403);
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return reply({ error: 'Too many tries. Wait a few minutes, then try again.' }, 429);

  const action = new URL(req.url).searchParams.get('action');
  const b = await req.json().catch(() => ({}));
  try {
    const found = await findInvite(b.token);
    if (!('invite' in found)) return reply({ error: found.error }, found.status);
    const invite = found.invite!;

    if (action === 'check') return reply({ ok: true, role: invite.role, expires_at: invite.expires_at, inviter: 'Ahmed Masoud', team: 'F1 Predictor' });

    if (action === 'upload') {
      const ext = CV_TYPES[String(b.type || '')];
      if (!ext) return reply({ error: 'The CV has to be a PDF or a Word file.' }, 400);
      if (!(Number(b.size) > 0 && Number(b.size) <= MAX_CV)) return reply({ error: 'The CV has to be smaller than 10 MB.' }, 400);
      const path = `cv/${invite.id}/${crypto.randomUUID()}.${ext}`;
      const r = await fetch(`${SB_URL}/storage/v1/object/upload/sign/applications/${path}`, {
        method: 'POST', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }, body: '{}',
        signal: AbortSignal.timeout(10000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) return reply({ error: 'Could not get the CV upload ready. Try again.' }, 502);
      return reply({ ok: true, path, uploadUrl: `${SB_URL}/storage/v1${j.url}` });
    }

    if (action === 'apply') {
      const v = validate(b, invite.id);
      if ('error' in v) return reply({ error: v.error, field: v.field }, 400);
      // Claim the invite first, so the same link can't be used twice at the same moment.
      const claimed = await db(`admin_invites?id=eq.${invite.id}&used_at=is.null`, { method: 'PATCH', body: { used_at: new Date().toISOString() }, prefer: 'return=representation' });
      if (!claimed?.length) return reply({ error: 'This invite link was already used to apply.' }, 410);
      const release = () => db(`admin_invites?id=eq.${invite.id}`, { method: 'PATCH', body: { used_at: null }, prefer: 'return=minimal' }).catch(() => {});
      let user: Json;
      try {
        user = await authAdmin('users', { method: 'POST', body: {
          email: v.row.email, password: v.password, email_confirm: true, ban_duration: '876000h',
          app_metadata: { role: 'applicant' }, user_metadata: { full_name: v.row.full_name, title: invite.role },
        } });
      } catch (e: any) {
        await release();
        if (e.status === 422 && /already|exists|registered/i.test(e.message)) return reply({ error: 'There is already an account with this email. Use another email, or ask Ahmed.', field: 'email' }, 409);
        if (/password/i.test(e.message)) return reply({ error: e.message, field: 'password' }, 400);
        throw e;
      }
      try {
        await db('member_applications', { method: 'POST', prefer: 'return=minimal', body: { ...v.row, invite_id: invite.id, role: invite.role, auth_user_id: user.id } });
      } catch (e) {
        await authAdmin(`users/${user.id}`, { method: 'DELETE' }).catch(() => {});
        await release();
        throw e;
      }
      await notifyOwner(v.row.full_name, invite.role);
      return reply({ ok: true, first_name: v.row.full_name.split(/\s+/)[0] });
    }
    return reply({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('[join]', action, e);
    return reply({ error: 'Something went wrong on our side. Try again in a minute.' }, 500);
  }
}

Deno.serve(handle);
