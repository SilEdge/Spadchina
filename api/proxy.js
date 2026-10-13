const DEFAULT_UPSTREAM = 'https://marathon-obvious-unable.ngrok-free.dev';

export default async function handler(req, res) {
  const requestUrl = new URL(req.url, 'https://spadchina.vercel.app');
  const path = requestUrl.searchParams.get('path');
  if (!path || path.startsWith('/') || path.includes('..')) {
    res.status(400).json({ error: 'invalid API path' });
    return;
  }

  requestUrl.searchParams.delete('path');
  const upstreamOrigin = process.env.API_UPSTREAM_URL || DEFAULT_UPSTREAM;
  const upstreamUrl = new URL(`/api/${path}${requestUrl.search}`, upstreamOrigin);
  const headers = {
    Accept: req.headers.accept || 'application/json',
    'ngrok-skip-browser-warning': 'true',
  };
  if (req.headers.authorization) headers.Authorization = req.headers.authorization;
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
  const body = ['GET', 'HEAD'].includes(req.method)
    ? undefined
    : (typeof req.body === 'string' || Buffer.isBuffer(req.body)
      ? req.body
      : JSON.stringify(req.body ?? {}));

  try {
    const response = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body,
      signal: AbortSignal.timeout(20000),
    });
    const upstreamBody = Buffer.from(await response.arrayBuffer());
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.send(upstreamBody);
  } catch (error) {
    console.error('backend proxy failed:', error);
    res.status(502).json({ error: 'backend unavailable' });
  }
}
