// Geometry is independent of trip IDs, service dates and predicted arrival times.
// A shape content hash invalidates paths when an agency changes its geometry.
export type Point=[number,number];
export type Stop={id:string;name:string;lng:number;lat:number;arrival:number;departure:number;sequence:number};
export type Vehicle={id:string;route:string;headsign:string;mode:'subway'|'ferry';shape:string;stops:Stop[];live:boolean;gps?:Point};
export type Segment={key:string;path:Point[];dist:number[];start:number;end:number};
export type Prepared=Vehicle&{path:Point[];dist:number[];stopDist:number[];segments:Segment[]};
type Indexed={path:Point[];dist:number[];revision:string};
const indexes=new WeakMap<Point[],Indexed>();
const journeys=new Map<string,{stopDist:number[];segments:Segment[]}>();
const segmentCache=new Map<string,Segment>();
const distance=(a:Point,b:Point)=>Math.hypot((a[0]-b[0])*.76,a[1]-b[1]);
function index(path:Point[]):Indexed{const existing=indexes.get(path);if(existing)return existing;const dist=[0];let hash=2166136261;for(let i=0;i<path.length;i++){if(i)dist[i]=dist[i-1]+distance(path[i],path[i-1]);for(const n of path[i]){hash=Math.imul(hash^Math.round(n*1e6),16777619)>>>0;}}const value={path,dist,revision:hash.toString(36)};indexes.set(path,value);return value;}
export function pathDistance(v:{path:Point[];dist:number[]},p:Point,min=0){let best=Infinity,found=min;for(let i=1;i<v.path.length;i++){if(v.dist[i]<min)continue;const a=v.path[i-1],b=v.path[i];const dx=(b[0]-a[0])*.76,dy=b[1]-a[1];const q=Math.max(0,Math.min(1,(((p[0]-a[0])*.76)*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));const projected:Point=[a[0]+(b[0]-a[0])*q,a[1]+(b[1]-a[1])*q];const error=distance(p,projected),d=v.dist[i-1]+(v.dist[i]-v.dist[i-1])*q;if(d>=min&&error<best){best=error;found=d;}}return found;}
function sample(v:{path:Point[];dist:number[]},d:number):Point{let lo=1,hi=v.dist.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(v.dist[mid]<d)lo=mid+1;else hi=mid;}const j=lo,q=Math.max(0,Math.min(1,(d-v.dist[j-1])/Math.max(1e-10,v.dist[j]-v.dist[j-1])));return [v.path[j-1][0]+(v.path[j][0]-v.path[j-1][0])*q,v.path[j-1][1]+(v.path[j][1]-v.path[j-1][1])*q];}
export function getSegment(shapeId:string,path:Point[],from:Stop,to:Stop,minimumDistance=0):Segment{
 const geometry=index(path);
 // minimumDistance disambiguates repeated stops on looping shapes.
 const key=`${geometry.revision}|${shapeId}|${from.id}>${to.id}|${minimumDistance.toFixed(8)}`;
 const cached=segmentCache.get(key);if(cached)return cached;
 const start=pathDistance(geometry,[from.lng,from.lat],minimumDistance),end=pathDistance(geometry,[to.lng,to.lat],start);
 const points=[sample(geometry,start)];const distances=[0];for(let i=0;i<path.length;i++)if(geometry.dist[i]>start&&geometry.dist[i]<end){points.push(path[i]);distances.push(geometry.dist[i]-start);}points.push(sample(geometry,end));distances.push(end-start);
 const result={key,path:points,dist:distances,start,end};segmentCache.set(key,result);return result;
}
export function prepare(v:Vehicle,shapes:Record<string,Point[]>):Prepared{
 const path=shapes[v.shape];if(!path||path.length<2)throw Error('No verified route geometry');const geometry=index(path);
 const key=`${geometry.revision}|${v.shape}|${v.stops.map(s=>s.id).join('>')}`;let journey=journeys.get(key);
 if(!journey){const segments:Segment[]=[];let minimum=0;for(let i=1;i<v.stops.length;i++){const segment=getSegment(v.shape,path,v.stops[i-1],v.stops[i],minimum);segments.push(segment);minimum=segment.end;}journey={segments,stopDist:[segments[0]?.start??0,...segments.map(s=>s.end)]};journeys.set(key,journey);}
 return {...v,path,dist:geometry.dist,...journey};
}
export function travelDistance(v:Prepared,now:number){if(v.gps)return pathDistance(v,v.gps);let i=v.stops.findIndex(s=>s.arrival>now);if(i<0)i=v.stops.length-1;if(i===0)return v.stopDist[0];const a=v.stops[i-1],b=v.stops[i],p=Math.max(0,Math.min(1,(now-a.departure)/Math.max(1,b.arrival-a.departure)));return v.stopDist[i-1]+(v.stopDist[i]-v.stopDist[i-1])*p;}
export function along(v:Prepared,d:number):Point{const safe=waterBounds.get(v.shape);if(safe)d=Math.max(safe[0],Math.min(safe[1],d));const segment=v.segments.find(s=>d<=s.end)??v.segments[v.segments.length-1];return sample(segment,d-segment.start);}
export function position(v:Prepared,now:number):Point{return along(v,travelDistance(v,now));}
export type Network={edges:{from:string;to:string;coordinates:Point[]}[];shapes:Record<string,number[]>;waterBounds?:Record<string,[number,number]>};
const waterBounds=new Map<string,[number,number]>();
export function decodeNetwork(network:Network):Record<string,Point[]>{const shapes:Record<string,Point[]>={};for(const [id,refs] of Object.entries(network.shapes)){const points:Point[]=[];for(const reference of refs){const coordinates=network.edges[Math.abs(reference)-1].coordinates;for(let i=0;i<coordinates.length;i++){const p=coordinates[reference>0?i:coordinates.length-1-i];if(points.length&&i===0&&points.at(-1)![0]===p[0]&&points.at(-1)![1]===p[1])continue;points.push(p);}}shapes[id]=points;}for(const [id,bounds] of Object.entries(network.waterBounds??{}))waterBounds.set(id,bounds);return shapes;}
