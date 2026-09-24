import raw from '@/data/transit.json';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
type StopTime=[string,number,number,number];
type Trip=[string,string,string,string,string,number,number];
type Data={sources:Record<string,{downloaded:string}>;stops:Record<string,[string,number,number]>;routes:Record<string,[string,string,string]>;trips:Trip[];patterns:StopTime[][];calendars:Record<string,[string,string,number[]]>;exceptions:Record<string,Record<string,number>>};
const db=raw as unknown as Data;
const urls={subway:['gtfs','gtfs-ace','gtfs-bdfm','gtfs-g','gtfs-jz','gtfs-nqrw','gtfs-l','gtfs-si'].map(s=>'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2F'+s),ferry:['https://nycferry.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/tripupdate','https://nycferry.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/vehicleposition']};
let cached:{time:number;value:unknown;key:string}|undefined;
async function feed(url:string){const r=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Feed unavailable');return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(await r.arrayBuffer()));}
export async function GET(request:Request){
 const params=new URL(request.url).searchParams;const live={subway:params.get('subway')==='live',ferry:params.get('ferry')==='live'};const key=JSON.stringify(live);if(cached&&cached.key===key&&Date.now()-cached.time<20000)return Response.json(cached.value);
 const now=Date.now()/1000;const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
 const sec=+parts.hour*3600+ +parts.minute*60+ +parts.second;const midnight=now-sec;const today=`${parts.year}${parts.month}${parts.day}`;const date=new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);const day=(date.getUTCDay()+6)%7;
 const yesterdayDate=new Date(date.getTime()-86400000);const yesterday=yesterdayDate.toISOString().slice(0,10).replaceAll('-','');
 const active=(service:string,d:string,dow:number)=>{const ex=db.exceptions[service]?.[d];if(ex)return ex===1;const c=db.calendars[service];return !!c&&d>=c[0]&&d<=c[1]&&c[2][dow]===1;};
 const status:Record<string,string>={subway:'Scheduled',ferry:'Scheduled'};
 const updates=new Map<string,any>();const positions=new Map<string,any>();
 await Promise.all((['subway','ferry'] as const).map(async mode=>{if(!live[mode])return;const results=await Promise.allSettled(urls[mode].map(feed));let success=0;for(const r of results){if(r.status==='rejected')continue;const age=now-Number(r.value.header.timestamp);if(!Number.isFinite(age)||age>180)continue;success++;for(const e of r.value.entity){if(e.tripUpdate?.trip?.tripId)updates.set(mode+':'+e.tripUpdate.trip.tripId,e.tripUpdate);if(e.vehicle?.trip?.tripId&&e.vehicle.position)positions.set(mode+':'+e.vehicle.trip.tripId,e.vehicle);}}status[mode]=success===0?'Live unavailable · using schedule':success<results.length?'Partial live data · schedule fallback':mode==='subway'?'Live arrivals · estimated positions':'Live ferry data';}));
 const vehicles=[];
 for(const t of db.trips){const [id,route,service,headsign,shape,pattern,start]=t;const st=db.patterns[pattern];const mode=db.routes[route][2];
  for(const offset of [0,-1]){const base=midnight+offset*86400;if(!active(service,offset===0?today:yesterday,offset===0?day:(day+6)%7))continue;
   const normalized=id.startsWith('subway:')?'subway:'+id.split('_').slice(-2).join('_'):id;const candidate=updates.get(normalized);const serviceDate=offset===0?today:yesterday;const update=candidate&&(!candidate.trip.startDate||candidate.trip.startDate===serviceDate)?candidate:undefined;if(!update&&(base+start+st[0][2]>now+30||base+start+st[st.length-1][1]<now))continue;if(update?.trip?.scheduleRelationship===3)continue;
   let stops=st.map(s=>({id:s[0],name:db.stops[s[0]]?.[0]??s[0],lng:db.stops[s[0]]?.[1],lat:db.stops[s[0]]?.[2],arrival:base+start+s[1],departure:base+start+s[2],sequence:s[3]}));
   let isLive=false;
   if(update){const us=update.stopTimeUpdate??[];const byId=new Map(us.map((u:any)=>[mode+':'+u.stopId,u]));let delay=Number(update.delay)||0;stops=stops.flatMap(s=>{const u:any=byId.get(s.id);if(u?.scheduleRelationship===1)return [];if(u){const a=Number(u.arrival?.time)||0;const d=Number(u.departure?.time)||0;if(a)delay=a-s.arrival;else if(u.arrival?.delay!=null)delay=Number(u.arrival.delay);isLive=true;return [{...s,arrival:a||s.arrival+delay,departure:d||s.departure+delay}];}return [{...s,arrival:s.arrival+delay,departure:s.departure+delay}];});}
   if(stops.length<2||stops[0].departure>now+30||stops[stops.length-1].arrival<now)continue;
   if(!stops.some(s=>s.lat>40.64&&s.lat<40.83&&s.lng>-74.06&&s.lng<-73.9))continue;
   const vp=positions.get(id);const gps=vp&&now-Number(vp.timestamp||0)<120?[vp.position.longitude,vp.position.latitude]:undefined;
   vehicles.push({id:id+':'+offset,route:db.routes[route][0],headsign:headsign||stops[stops.length-1].name,mode,shape,stops,live:isLive||!!gps,gps});
  }
 }
 const result={vehicles,status,serverTime:now,sources:db.sources,date:today};cached={time:Date.now(),value:result,key};return Response.json(result,{headers:{'Cache-Control':'public, max-age=15'}});
}
