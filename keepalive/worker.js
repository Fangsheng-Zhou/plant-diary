// Plant Diary keep-alive for Cloudflare Workers (free plan).
//
// Pings the Supabase database once a day so the free project never pauses
// from inactivity. It only calls the public ping() function, which returns
// "ok" and reads no data.
//
// Setup (about 5 minutes, once):
//   1. Cloudflare dashboard > Workers & Pages > Create > Create Worker.
//      Name it "plant-diary-keepalive" and deploy the starter.
//   2. Click "Edit code", replace everything with this file, then Deploy.
//   3. Settings > Triggers > Cron Triggers > Add: "17 9 * * *" (daily, 09:17 UTC).
//   4. Optional check: open the Worker URL in a browser. It should say "ok".

const SUPABASE_URL = 'https://eqfyaeyyiockapusiatn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_iMbvvdV-VzVkCk-hBvr7SA_6qPySF4H';

async function ping() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ping`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: '{}',
  });
  return `${res.status} ${await res.text()}`;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(ping().then((r) => console.log('keep-alive', r)));
  },
  async fetch() {
    return new Response(await ping(), { headers: { 'content-type': 'text/plain' } });
  },
};
