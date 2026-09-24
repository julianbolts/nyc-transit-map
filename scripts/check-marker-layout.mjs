// Browser fixture for the primary marker root (no WebGL required).
// Generate into public/__marker-layout.html, inspect in preview, remove before publish.
import fs from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync('lib/transit-style.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {appearance}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const css=fs.readFileSync('node_modules/maplibre-gl/dist/maplibre-gl.css','utf8')+fs.readFileSync('app/globals.css','utf8').replace(/@import[^;]+;/g,'');
const routes=['1','2','3','4','6X','7','A','B','G','J','L','N','R','W','ER','RS'];
const markers=routes.map((route,i)=>{const mode=i<14?'subway':'ferry',a=appearance(mode,route),x=65+i%8*100,y=70+Math.floor(i/8)*130;return `<button data-x="${x}" data-y="${y}" data-route="${route}" class="maplibregl-marker vehicle ${mode}${a.express?' express':''}" style="--route-color:${a.color};--route-text:${a.text};transform:translate(-50%,-50%) translate(${x}px,${y}px)"><span class="badge-shape"></span><span class="badge-label">${a.label}</span></button>`;}).join('');
const checks=`const markers=[...document.querySelectorAll('[data-route]')];const results=markers.map(el=>{const r=el.getBoundingClientRect();return {route:el.dataset.route,position:getComputedStyle(el).position,error:Math.hypot(r.x+r.width/2-Number(el.dataset.x),r.y+r.height/2-Number(el.dataset.y))};});document.querySelector('output').textContent=JSON.stringify({pass:results.every(x=>x.position==='absolute'&&x.error<1),results},null,2);`;
fs.writeFileSync(process.argv[2]??'public/__marker-layout.html',`<!doctype html><meta charset="utf-8"><style>${css}</style><main style="position:absolute;inset:0">${markers}</main><output style="position:absolute;top:300px;white-space:pre;font:12px monospace"></output><script>${checks}</script>`);
