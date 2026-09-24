import fs from 'node:fs';import {gunzipSync} from 'node:zlib';import {VectorTile} from '@mapbox/vector-tile';import {PbfReader} from 'pbf';
import {decodeNetwork} from '../lib/transit-geometry.ts';
const network=JSON.parse(fs.readFileSync('public/data/network.json'));const shapes=decodeNetwork(network);const cache=new Map();
function water(lng,lat){const x=(lng+180)/360*4096,y=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*4096;const tx=Math.floor(x),ty=Math.floor(y),key=tx+'-'+ty;let tile=cache.get(key);if(!tile){const file='/tmp/water-tiles/'+key+'.mvt';if(!fs.existsSync(file))return null;tile=new VectorTile(new PbfReader(gunzipSync(fs.readFileSync(file))));cache.set(key,tile);}const layer=tile.layers.water;if(!layer)return false;const px=(x-tx)*layer.extent,py=(y-ty)*layer.extent;for(let i=0;i<layer.length;i++){let inside=false;for(const ring of layer.feature(i).loadGeometry()){for(let a=0,b=ring.length-1;a<ring.length;b=a++){const p=ring[a],q=ring[b];if((p.y>py)!==(q.y>py)&&px<(q.x-p.x)*(py-p.y)/(q.y-p.y)+p.x)inside=!inside;}}if(inside)return true;}return false;}
// Clip shore-side terminal coordinates to the first wet point on the same route.
let clipped=0;
for(const edge of network.edges){
 if(!edge.from.startsWith('ferry:')&&!edge.to.startsWith('ferry:'))continue;
 const p=edge.coordinates;const samples=[];
 for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i],n=Math.max(1,Math.ceil(Math.hypot((b[0]-a[0])*.76,b[1]-a[1])*111000/12));for(let j=0;j<n;j++)samples.push([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n]);}samples.push(p.at(-1));
 let first=0,last=samples.length-1;
 if(water(...samples[first])===false){while(first<last&&water(...samples[first])!==true)first++;clipped++;}
 if(water(...samples[last])===false){while(last>first&&water(...samples[last])!==true)last--;clipped++;}
 if(first||last<samples.length-1){edge.coordinates=samples.slice(first,last+1);}
}
fs.writeFileSync('public/data/network.json',JSON.stringify(network));
const final=decodeNetwork(network);let checked=0;const failed=[];
for(const [id,path] of Object.entries(final)){if(!id.startsWith('ferry:'))continue;for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],steps=Math.max(1,Math.ceil(Math.hypot((b[0]-a[0])*.76,b[1]-a[1])*111000/25));for(let j=0;j<=steps;j++){const p=[a[0]+(b[0]-a[0])*j/steps,a[1]+(b[1]-a[1])*j/steps];if(p[0]<-74.06||p[0]>-73.9||p[1]<40.64||p[1]>40.83)continue;const w=water(...p);if(w===null)continue;checked++;if(!w)failed.push({id,segment:i,p});}}}
console.log({checked,clipped,offWater:failed.length,examples:failed.slice(0,5)});
fs.writeFileSync('/tmp/water-validation.json',JSON.stringify(failed));
