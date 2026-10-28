const pending = new Map<string, Promise<unknown>>();
const memory = new Map<string, { expires: number; value: unknown }>();
// Persistent browser cache plus single-flight requests. Cache failures never block the app.
export function cachedJSON<T>(
  url: string,
  ttlSeconds: number,
  options: {
    staleIfError?: boolean;
    revalidate?: boolean;
    validate?: (value: T) => boolean;
  } = {},
): Promise<T> {
  const hit = memory.get(url);
  const valid = (value: unknown) =>
    value !== undefined && (!options.validate || options.validate(value as T));
  if (hit && hit.expires > Date.now() && valid(hit.value))
    return Promise.resolve(hit.value as T);
  const existing = pending.get(url);
  if (existing) return existing as Promise<T>;
  const task = (async () => {
    let cache: Cache | undefined;
    let stale = hit?.value;
    try {
      cache = await caches.open("city-in-motion-v2");
      const response = await cache.match(url);
      if (response && options.staleIfError)
        stale = await response.clone().json();
      if (
        response &&
        Number(response.headers.get("X-Client-Expires")) > Date.now()
      ) {
        const value = await response.json();
        if (!valid(value)) throw Error("Invalid cached JSON");
        memory.set(url, {
          value,
          expires: Number(response.headers.get("X-Client-Expires")),
        });
        return value as T;
      }
    } catch {}
    let value: any;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(12000),
        ...(options.revalidate ? { cache: "no-cache" as const } : {}),
      });
      if (!response.ok) throw Error(`Request failed (${response.status})`);
      value = await response.json();
      if (!valid(value)) throw Error("Invalid JSON response");
    } catch (error) {
      if (options.staleIfError && valid(stale)) return stale as T;
      throw error;
    }
    const expires = Math.min(
      Date.now() + ttlSeconds * 1000,
      value.validUntil ? value.validUntil * 1000 : Infinity,
    );
    memory.set(url, { value, expires });
    if (cache) {
      try {
        await cache.put(
          url,
          new Response(JSON.stringify(value), {
            headers: {
              "Content-Type": "application/json",
              "X-Client-Expires": String(expires),
            },
          }),
        );
      } catch {}
    }
    return value as T;
  })().finally(() => pending.delete(url));
  pending.set(url, task);
  return task;
}
