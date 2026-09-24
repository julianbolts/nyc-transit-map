import raw from '@/data/transit.json';
import type {ScheduleData} from '@/lib/schedule';
const db=raw as any;
let memory:{key:string;response:Response}|undefined;
export async function GET(request:Request){
 const now=new Date();const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 const iso=`${parts.year}-${parts.month}-${parts.day}`,date=iso.replaceAll('-','');const key='v2-'+date;const epoch=Math.floor(now.getTime()/1000);const seconds=+parts.hour*3600+ +parts.minute*60+ +parts.second;const midnight=epoch-seconds;
 if(memory?.key===key)return memory.response.clone();
 const cacheKey=new Request(new URL('/__cache/schedule/'+key,request.url));const edge=typeof caches!=='undefined'?(caches as any).default:undefined;let hit:Response|undefined;try{hit=await edge?.match(cacheKey);}catch{}if(hit){memory={key,response:hit.clone()};return hit;}
 const dateObj=new Date(iso+'T12:00:00Z');const day=(dateObj.getUTCDay()+6)%7;const yesterday=new Date(dateObj.getTime()-86400000).toISOString().slice(0,10).replaceAll('-','');
 const active=(id:string,d:string,dow:number)=>{const ex=db.exceptions[id]?.[d];if(ex)return ex===1;const c=db.calendars[id];return !!c&&d>=c[0]&&d<=c[1]&&c[2][dow]===1;};
 const patterns:ScheduleData['patterns']=[],trips:ScheduleData['trips']=[],indexes=new Map<number,number>();
 for(const [id,route,service,headsign,shape,pattern,start] of db.trips){for(const offset of [0,-1]){if(!active(service,offset?yesterday:date,offset?(day+6)%7:day))continue;const base=midnight+offset*86400;if(offset&&base+start+db.patterns[pattern].at(-1)[2]<midnight)continue;if(!indexes.has(pattern)){indexes.set(pattern,patterns.length);patterns.push(db.patterns[pattern]);}trips.push([id+':'+offset,route,headsign,shape,indexes.get(pattern)!,start,base]);}}
 const ttl=Math.min(86400,86400-seconds);const body:ScheduleData={version:key,sources:db.sources,stops:db.stops,routes:db.routes,patterns,trips,validUntil:epoch+ttl,date:iso};
 const response=Response.json(body,{headers:{'Cache-Control':`public, max-age=${ttl}, s-maxage=${ttl}`,'ETag':'"'+key+'"','X-Schedule-Date':iso}});memory={key,response:response.clone()};if(edge){try{await edge.put(cacheKey,response.clone());}catch{}}return response;
}
