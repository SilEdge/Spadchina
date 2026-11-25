// Retry reads, including read-only endpoints that accept a POST body.
export async function requestJSON(url, { retryRead = false, ...options } = {}) {
  const attempts = retryRead || (options.method || 'GET').toUpperCase() === 'GET' ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response;
    try { response = await fetch(url, options); }
    catch (error) {
      if (error.name === 'AbortError') throw error;
      if (attempt + 1 === attempts) throw new Error('Не удалось связаться с сервером. Проверьте подключение и повторите попытку.');
    }
    const transient = response && [502, 503, 504].includes(response.status);
    if ((!response || transient) && attempt + 1 < attempts) {
      await response?.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      continue;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Ошибка сервера (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }
}
