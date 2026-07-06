/**
 * PabLito proxy — Cloudflare Worker.
 * Держит ключ NavyAI у себя (секрет NAVY_API_KEY) и проксирует запросы на api.navy.
 * Приложение ходит на URL воркера — ключ в APK не попадает.
 *
 * Секреты (задаются через `wrangler secret put`):
 *   NAVY_API_KEY   — ключ sk-navy-...
 *   CLIENT_TOKEN   — (необязательно) общий токен: приложение шлёт его в
 *                    заголовке X-Client-Token, чтобы воркером не пользовались чужие.
 *
 * Стриминг (SSE) проходит насквозь, т.к. мы просто отдаём res.body как есть.
 */
export default {
  async fetch(request, env) {
    // CORS для удобной отладки (в проде можно сузить).
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Token',
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    // Необязательная проверка общего токена.
    if (env.CLIENT_TOKEN) {
      const token = request.headers.get('X-Client-Token');
      if (token !== env.CLIENT_TOKEN) {
        return new Response('Forbidden', { status: 403, headers: cors });
      }
    }

    const incoming = new URL(request.url);
    // /v1/chat/completions -> https://api.navy/v1/chat/completions
    const target = `https://api.navy${incoming.pathname}${incoming.search}`;

    // Копируем заголовки, подменяя авторизацию на наш секретный ключ.
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${env.NAVY_API_KEY}`);
    headers.delete('X-Client-Token');
    headers.delete('Host');

    const resp = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    });

    // Отдаём ответ как есть (включая поток SSE).
    const out = new Response(resp.body, {
      status: resp.status,
      headers: resp.headers,
    });
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
