import type {Map as GLMap} from 'maplibre-gl';

type Entry={at:string;event:string;detail?:Record<string,unknown>};
type SourceEvent={sourceId?:string;sourceDataType?:string;isSourceLoaded?:boolean};

// Keep this small enough to leave running while a tab is unattended for hours.
export function createMapDiagnostics(map:GLMap,engine:'maplibre'|'leaflet',maplibreVersion?:string){
 const history:Entry[]=[];
 const source={loading:0,data:0,metadata:0,content:0,lastLoading:null as string|null,lastData:null as string|null};
 const record=(event:string,detail?:Record<string,unknown>)=>{
  history.push({at:new Date().toISOString(),event,detail});
  if(history.length>80)history.shift();
 };
 const onError=(event:{error?:unknown;sourceId?:unknown})=>{
  const error=event.error;
  const value=error instanceof Error?{name:error.name,message:error.message,sourceId:event.sourceId}: {message:String(error),sourceId:event.sourceId};
  record('map_error',value);
 };
 const onWindowError=(event:ErrorEvent)=>{
  if(/maplibre|webgl|framebuffer|tile/i.test(event.message))record('window_error',{message:event.message});
 };
 const onUnhandledRejection=(event:PromiseRejectionEvent)=>{
  const message=event.reason instanceof Error?event.reason.message:String(event.reason);
  if(/maplibre|webgl|framebuffer|tile/i.test(message))record('unhandled_rejection',{message});
 };
 const onSourceLoading=(event:SourceEvent)=>{
  if(event.sourceId!=='carto')return;
  source.loading++;source.lastLoading=new Date().toISOString();
 };
 const onSourceData=(event:SourceEvent)=>{
  if(event.sourceId!=='carto')return;
  source.data++;source.lastData=new Date().toISOString();
  if(event.sourceDataType==='metadata')source.metadata++;
  if(event.sourceDataType==='content')source.content++;
 };
 const onContextLost=()=>record('webgl_context_lost');
 const onContextRestored=()=>record('webgl_context_restored');
 if(engine==='maplibre'){
  map.on('error',onError);
  map.on('sourcedataloading',onSourceLoading);
  map.on('sourcedata',onSourceData);
  map.on('webglcontextlost',onContextLost);
  map.on('webglcontextrestored',onContextRestored);
  window.addEventListener('error',onWindowError);
  window.addEventListener('unhandledrejection',onUnhandledRejection);
 }
 record('map_created',{engine});

 const inspect=()=>{
  const result:Record<string,unknown>={
   at:new Date().toISOString(),engine,visibilityState:document.visibilityState,
   hasFocus:document.hasFocus(),online:navigator.onLine,
  };
  const probe=<T,>(label:string,fn:()=>T):T|undefined=>{
   try{const value=fn();result[label]=value;return value;}
   catch(error){result[label+'Error']=error instanceof Error?error.message:String(error);return undefined;}
  };
  const center=probe('center',()=>{const value=map.getCenter();return{lng:value.lng,lat:value.lat};});
  if(center)probe('zoom',()=>map.getZoom());
  if(engine!=='maplibre')return result;
  const canvas=probe('canvasElement',()=>map.getCanvas());
  delete result.canvasElement;
  if(!canvas)return result;
  const gl=probe('webglContext',()=>canvas.getContext('webgl2')??canvas.getContext('webgl'));
  delete result.webglContext;
  const style=probe('style',()=>map.getStyle());
  delete result.style;
  const cartoLayers=(style?.layers??[]).filter(layer=>'source' in layer&&layer.source==='carto'&&layer.layout?.visibility!=='none').map(layer=>layer.id);
  probe('canvas',()=>{const css=getComputedStyle(canvas);return{width:canvas.width,height:canvas.height,clientWidth:canvas.clientWidth,clientHeight:canvas.clientHeight,opacity:css.opacity,visibility:css.visibility,contextLost:gl?.isContextLost()??null};});
  probe('styleLoaded',()=>map.isStyleLoaded());
  probe('cartoSourceExists',()=>!!map.getSource('carto'));
  result.cartoLayerCount=cartoLayers.length;
  probe('areTilesLoaded',()=>map.areTilesLoaded());
  if(result.cartoSourceExists)probe('cartoSourceLoaded',()=>map.isSourceLoaded('carto'));
  if(!result.styleLoaded||!result.cartoSourceExists||!canvas.width||!canvas.height)return result;
  const area:[[number,number],[number,number]]=[
   [canvas.clientWidth*.2,canvas.clientHeight*.2],
   [canvas.clientWidth*.8,canvas.clientHeight*.8],
  ];
  probe('cartoRenderedFeatures',()=>map.queryRenderedFeatures(area,{layers:cartoLayers}).length);
  probe('routeRenderedFeatures',()=>map.queryRenderedFeatures(area,{layers:['subway-routes','ferry-routes'].filter(id=>!!map.getLayer(id))}).length);
  probe('cartoTransportationSourceFeatures',()=>map.querySourceFeatures('carto',{sourceLayer:'transportation'}).length);
  return result;
 };
 const capture=(event:string)=>record(event,{snapshot:inspect()});
 const report=()=>({version:1,createdAt:new Date().toISOString(),page:location.pathname,pageStartedAt:new Date(performance.timeOrigin).toISOString(),navigationType:(performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming|undefined)?.type??null,wasDiscarded:(document as Document&{wasDiscarded?:boolean}).wasDiscarded??null,maplibreVersion:maplibreVersion??null,browser:navigator.userAgent,current:inspect(),sourceEvents:source,history:[...history]});
 const dispose=()=>{
  if(engine!=='maplibre')return;
  map.off('error',onError);
  map.off('sourcedataloading',onSourceLoading);
  map.off('sourcedata',onSourceData);
  map.off('webglcontextlost',onContextLost);
  map.off('webglcontextrestored',onContextRestored);
  window.removeEventListener('error',onWindowError);
  window.removeEventListener('unhandledrejection',onUnhandledRejection);
 };
 return {record,capture,report,dispose};
}

export type MapDiagnostics=ReturnType<typeof createMapDiagnostics>;
