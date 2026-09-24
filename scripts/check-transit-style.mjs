import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync('lib/transit-style.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {appearance,headingBetween,unwrapHeading}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
assert.equal(appearance('subway','4').color,appearance('subway','6').color);
for(const route of ['6X','7X','FX']){assert.ok(appearance('subway',route).express);assert.equal(appearance('subway',route).label,route[0]);}
assert.equal(appearance('subway','A').express,false);
assert.equal(appearance('ferry','RS').label,'RWS');
assert.equal(appearance('ferry','AS').color,'#FF6B00');
for(const [point,angle] of [[[0,1],0],[[1,0],90],[[0,-1],180],[[-1,0],270]])assert.equal(headingBetween([0,0],point),angle);
assert.equal(unwrapHeading(359,1),361);
const meta=JSON.parse(fs.readFileSync('public/data/route-meta.json'));
assert.equal(meta.terminals.length,25);
assert.ok(meta.stations.length>450);
assert.ok(Object.values(meta.shapes).every(x=>!['RES','RWS'].includes(x.route)));
console.log(`PASS: palettes, express variants, headings, ${meta.stations.length} subway stations and 25 ferry landings.`);
