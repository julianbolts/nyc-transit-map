import fs from 'node:fs';
import assert from 'node:assert/strict';
import {prepare,position,decodeNetwork} from '../src/transit-geometry.ts';
const shapes=decodeNetwork(JSON.parse(fs.readFileSync('public/data/network.json')));
const metadata=JSON.parse(fs.readFileSync('public/data/route-meta.json'));
let samples=0,count=0;const routes=new Set();
function distanceToPath(point,path){let best=Infinity;for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],dx=b[0]-a[0],dy=b[1]-a[1],q=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy||1)));best=Math.min(best,Math.hypot(point[0]-a[0]-q*dx,point[1]-a[1]-q*dy));}return best;}
for(const mode of ['subway','ferry']){
 const db=JSON.parse(fs.readFileSync(`public/data/${mode}-schedule.json`));const checked=new Set();
 for(const [id,route,headsign,shape,pattern,start,base] of db.trips){
  const key=shape+':'+pattern;if(checked.has(key))continue;checked.add(key);
  const stops=db.patterns[pattern].map(([id,a,d,sequence])=>({id,name:db.stops[id][0],lng:db.stops[id][1],lat:db.stops[id][2],arrival:base+start+a,departure:base+start+d,sequence}));
  const vehicle={id,route,headsign,shape,stops,mode,live:false};
  if(mode==='subway'){routes.add(route);assert.equal(metadata.shapes[shape].route,db.routes[route][0]);}
  const prepared=prepare(vehicle,shapes);assert.equal(prepared.segments.length,stops.length-1);
  for(const segment of prepared.segments){assert.ok(segment.end>=segment.start);assert.ok(segment.path.length>=2);}
  assert.equal(prepared.segments,prepare({...vehicle,id:'another-trip'},shapes).segments);
  for(const fraction of [.1,.5,.9]){const time=stops[0].departure+(stops.at(-1).arrival-stops[0].departure)*fraction;const point=position(prepared,time);assert.ok(point.every(Number.isFinite));assert.ok(distanceToPath(point,shapes[shape])<1e-8,`Off cached route: ${shape}`);samples++;}count++;
 }
}
console.log(`PASS: ${count} shape/timing patterns, ${samples} positions on verified paths, stable cache reuse; ${routes.size} subway assignments match metadata.`);
