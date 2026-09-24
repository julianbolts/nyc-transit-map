import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
const transpile=(source)=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
// Request-level cache test with isolated clock/cache dependencies.
const code=transpile(fs.readFileSync('lib/client-cache.ts','utf8'));
const {cachedJSON}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
let calls=0;const responses=new Map();globalThis.caches={open:async()=>({match:async key=>responses.get(key)?.clone(),put:async(key,response)=>responses.set(key,response.clone())})};globalThis.fetch=async()=>{calls++;await new Promise(r=>setTimeout(r,15));return Response.json({value:42});};
const values=await Promise.all(Array.from({length:12},()=>cachedJSON('/schedule-test',86400)));assert.equal(calls,1);assert.ok(values.every(x=>x.value===42));await cachedJSON('/schedule-test',86400);assert.equal(calls,1);
await cachedJSON('/expire-test',0);await cachedJSON('/expire-test',0);assert.equal(calls,3);
// Production worker and its relative ESM dependency must be shipped together.
for(const name of ['maplibre-gl-worker.mjs','maplibre-gl-shared.mjs'])assert.ok(fs.statSync('public/vendor/maplibre-6.10.0/'+name).size>0);
for(const name of ['mobile','desktop'])assert.ok(fs.statSync('public/map/backdrop-'+name+'.webp').size>0);
console.log('PASS: 12 concurrent schedule requests share one fetch; cache reused; expiry refetches; worker and backdrop assets exist.');
