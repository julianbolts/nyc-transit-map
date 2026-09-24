import fs from 'node:fs';
import assert from 'node:assert/strict';
import {prepare,getSegment,position,decodeNetwork} from '../lib/transit-geometry.ts';
const db=JSON.parse(fs.readFileSync('data/transit.json')),shapes=decodeNetwork(JSON.parse(fs.readFileSync('public/data/network.json')));
const metadata=JSON.parse(fs.readFileSync('public/data/route-meta.json'));
let samples=0;const routes=new Set();
function distanceToPath(point,path){let best=Infinity;for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],dx=b[0]-a[0],dy=b[1]-a[1],q=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy||1)));best=Math.min(best,Math.hypot(point[0]-a[0]-q*dx,point[1]-a[1]-q*dy));}return best;}
let count=0;const checked=new Set();
for(const t of db.trips){const pattern=db.patterns[t[5]];const key=t[4]+':'+t[5];if(checked.has(key))continue;checked.add(key);const stops=pattern.map(s=>({id:s[0],name:db.stops[s[0]][0],lng:db.stops[s[0]][1],lat:db.stops[s[0]][2],arrival:s[1]+t[6],departure:s[2]+t[6],sequence:s[3]}));const v={id:t[0],shape:t[4],stops,mode:t[0].split(':')[0],route:t[1],headsign:t[3],live:false};if(v.mode==='subway'){routes.add(t[1]);assert.equal(metadata.shapes[v.shape].route,db.routes[t[1]][0],`Wrong line assigned to ${v.shape}`);}const p=prepare(v,shapes);assert.equal(p.segments.length,stops.length-1);for(const seg of p.segments){assert.ok(seg.end>=seg.start);assert.ok(seg.path.length>=2);}const again=prepare({...v,id:'another-trip'},shapes);assert.equal(p.segments,again.segments);const pos=position(p,(stops[0].departure+stops.at(-1).arrival)/2);assert.ok(pos.every(Number.isFinite));for(const fraction of [.1,.5,.9]){const time=stops[0].departure+(stops.at(-1).arrival-stops[0].departure)*fraction;const point=position(p,time);assert.ok(distanceToPath(point,shapes[v.shape])<1e-8,`Off cached route: ${v.shape}`);samples++;}count++;}
console.log(`Checked ${count} shape/timing patterns: valid segments, stable cache reuse, finite path positions.`);

console.log(`Checked ${samples} animated positions lie on cached paths; ${routes.size} subway route assignments match metadata.`);
