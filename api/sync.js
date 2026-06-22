// Vercel Serverless Function — HKSI 学习进度同步后端
// 放置路径：项目根目录下  api/sync.js   （访问地址即 https://你的域名/api/sync）
//
// 依赖一个 KV / Upstash Redis 存储（在 Vercel 控制台 Storage 里一键创建并连接到本项目）。
// 连接后 Vercel 会自动注入下面任一组环境变量，本函数都兼容：
//   KV_REST_API_URL / KV_REST_API_TOKEN              （Vercel KV）
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN （Upstash 集成）
//
// 接口：
//   GET  /api/sync?code=XXXX        → 返回该同步码对应的进度 JSON（无则 {}）
//   POST /api/sync?code=XXXX  body:JSON → 保存该进度，返回 {ok:true, code}
//   POST /api/sync           (无 code) body:JSON → 新建并返回 {ok:true, code}

export default async function handler(req, res) {
  const BASE  = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
  const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!BASE || !TOKEN) {
    res.status(500).json({ error: 'KV 未配置：请在 Vercel 控制台 Storage 创建 KV/Upstash 并连接本项目' });
    return;
  }
  const auth = { Authorization: 'Bearer ' + TOKEN };
  const sanitize = (c) => (c || '').toString().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

  try {
    if (req.method === 'GET') {
      const code = sanitize(req.query && req.query.code);
      if (!code) { res.status(400).json({ error: 'missing code' }); return; }
      const r = await fetch(`${BASE}/get/hksi:${code}`, { headers: auth });
      const j = await r.json().catch(() => ({}));
      let data = {};
      if (j && j.result) { try { data = JSON.parse(j.result); } catch (e) { data = {}; } }
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(data);
      return;
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      if (!body || typeof body !== 'object') body = {};
      let code = sanitize(req.query && req.query.code);
      if (!code) {
        code = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
      }
      const value = JSON.stringify(body);
      // Upstash REST: 把值放在请求体里，避免特殊字符的 URL 编码问题
      const r = await fetch(`${BASE}/set/hksi:${code}`, { method: 'POST', headers: auth, body: value });
      if (!r.ok) { const t = await r.text().catch(() => ''); res.status(502).json({ error: 'KV 写入失败: ' + t.slice(0, 200) }); return; }
      res.status(200).json({ ok: true, code });
      return;
    }

    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
