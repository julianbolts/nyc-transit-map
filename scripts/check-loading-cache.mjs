import fs from "node:fs";
import assert from "node:assert/strict";
import ts from "typescript";
const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText;
const moduleUrl = (code) =>
  "data:text/javascript;base64," + Buffer.from(code).toString("base64");
const code = transpile(fs.readFileSync("src/client-cache.ts", "utf8"));
const cacheUrl = moduleUrl(code);
const { cachedJSON } = await import(cacheUrl);
let calls = 0;
const responses = new Map();
globalThis.caches = {
  open: async () => ({
    match: async (key) => responses.get(key)?.clone(),
    put: async (key, response) => responses.set(key, response.clone()),
  }),
};
globalThis.fetch = async () => {
  calls++;
  await new Promise((r) => setTimeout(r, 15));
  return Response.json({ value: 42 });
};
const values = await Promise.all(
  Array.from({ length: 12 }, () => cachedJSON("/schedule-test", 86400)),
);
assert.equal(calls, 1);
assert.ok(values.every((x) => x.value === 42));
await cachedJSON("/schedule-test", 86400);
assert.equal(calls, 1);
await cachedJSON("/expire-test", 0);
await cachedJSON("/expire-test", 0);
assert.equal(calls, 3);

// Expired templates remain useful when a request fails, including on a fresh page.
await cachedJSON("/stale-test", 0, { staleIfError: true });
globalThis.fetch = async () => {
  throw Error("offline");
};
assert.deepEqual(await cachedJSON("/stale-test", 0, { staleIfError: true }), {
  value: 42,
});
const freshCache = await import(
  moduleUrl(code + "\n// fresh page with empty memory")
);
assert.deepEqual(
  await freshCache.cachedJSON("/stale-test", 0, { staleIfError: true }),
  { value: 42 },
);
await assert.rejects(
  cachedJSON("/missing", 0, { staleIfError: true }),
  /offline/,
);
await assert.rejects(cachedJSON("/expire-test", 0), /offline/);

// Invalid successful JSON responses must not poison the last usable persisted data.
globalThis.fetch = async () => Response.json({ invalid: true });
const valid = (value) => value?.value === 42;
assert.deepEqual(
  await cachedJSON("/stale-test", 0, { staleIfError: true, validate: valid }),
  { value: 42 },
);
assert.deepEqual(await await responses.get("/stale-test").clone().json(), {
  value: 42,
});
await assert.rejects(
  cachedJSON("/invalid", 0, { staleIfError: true, validate: valid }),
  /Invalid JSON/,
);

// Loader uses one self-contained bundle, stays referentially stable, and adopts revisions.
const loaderSource = transpile(fs.readFileSync("src/data.ts", "utf8"))
  .replace('"./client-cache"', JSON.stringify(cacheUrl))
  .replace(
    /export \{ scheduledVehicles, newYorkDate \} from "\.\/schedule";/,
    "",
  );
const { loadMockSchedules } = await import(moduleUrl(loaderSource));
let revision = "first",
  bundleCalls = 0;
globalThis.fetch = async (url, options) => {
  bundleCalls++;
  assert.equal(url, "/project/data/transit-bundle.json");
  assert.equal(options.cache, "no-cache");
  return Response.json({
    schemaVersion: 1,
    version: revision,
    schedules: {
      subway: { kind: "weekly-template" },
      ferry: { kind: "weekly-template" },
    },
    assets: {
      version: revision,
      network: { edges: [] },
      metadata: { shapes: {} },
    },
  });
};
const first = await loadMockSchedules("/project/");
assert.equal(await loadMockSchedules("/project/"), first);
assert.equal(bundleCalls, 1);
const originalNow = Date.now;
let clock = originalNow();
Date.now = () => clock;
try {
  clock += 61000;
  assert.equal(await loadMockSchedules("/project/"), first);
  assert.equal(bundleCalls, 2);
  revision = "second";
  clock += 61000;
  const second = await loadMockSchedules("/project/");
  assert.notEqual(second, first);
  assert.equal(second.assets.version, "second");
  assert.equal(bundleCalls, 3);
  clock += 61000;
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  assert.equal(await loadMockSchedules("/project/"), second);
} finally {
  Date.now = originalNow;
}
for (const name of ["mobile", "desktop"])
  assert.ok(fs.statSync("public/map/backdrop-" + name + ".webp").size > 0);
console.log(
  "PASS: concurrent requests, TTL, persistent stale fallback, validation, coherent bundle revisions and stable loader references.",
);
