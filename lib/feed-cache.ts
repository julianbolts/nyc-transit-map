import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
const pending=new Map<string,Promise<any>>();
const memory=new Map<string,{until:number;value?:any;error?:Error}>();
// Shared per-edge-location cache. Concurrent requests in one isolate share one upstream fetch.
export async function cachedFeed(url:string,ttl:number){
 const hit=memory.get(url);if(hit&&hit.until>Date.now()){if(hit.error)throw hit.error;return hit.value;}
 const existing=pending.get(url);if(existing)return existing;
 const task=(async()=>{const edge=typeof caches!=='undefined'?(caches as any).default:undefined;const key=new Request(url);let saved:Response|undefined;try{saved=await edge?.match(key);}catch{}if(saved){if(saved.headers.get('X-Upstream-Failed')){const error=Error('Feed cooling down');memory.set(url,{until:Date.now()+10000,error});throw error;}const value=GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(await saved.arrayBuffer()));const remaining=Math.max(0,Number(saved.headers.get('X-Feed-Expires'))-Date.now());memory.set(url,{until:Date.now()+remaining,value});return value;}
  try{const response=await fetch(url,{signal:AbortSignal.timeout(6000)});if(!response.ok){const retry=response.headers.get('Retry-After');const seconds=retry?(Number(retry)||Math.ceil((Date.parse(retry)-Date.now())/1000)):60;const error=new Error(`Upstream ${response.status}`);Object.assign(error,{retry:Math.max(30,Math.min(3600,seconds))});throw error;}
   const bytes=await response.arrayBuffer();const value=GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(bytes));const until=Date.now()+ttl*1000;memory.set(url,{until,value});if(edge){try{await edge.put(key,new Response(bytes,{headers:{'Content-Type':'application/x-protobuf','Cache-Control':`public, max-age=${ttl}`,'X-Feed-Expires':String(until)}}));}catch{}}return value;
  }catch(error){const retry=(error as any).retry??60;memory.set(url,{until:Date.now()+retry*1000,error:error as Error});if(edge){try{await edge.put(key,new Response('',{headers:{'Cache-Control':`public, max-age=${retry}`,'X-Upstream-Failed':'1'}}));}catch{}}throw error;}
 })().finally(()=>pending.delete(url));pending.set(url,task);return task;
}
