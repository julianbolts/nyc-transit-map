import L from 'leaflet';
import {VectorTile} from '@mapbox/vector-tile';
import {PbfReader as Pbf} from 'pbf';
type Point=[number,number];
const latLng=(p:Point)=>L.latLng(p[1],p[0]);
class InkTiles extends L.GridLayer{
 createTile(coords:L.Coords,done:L.DoneCallback){const canvas=document.createElement('canvas');canvas.width=canvas.height=512;canvas.style.width=canvas.style.height='256px';const ctx=canvas.getContext('2d')!;ctx.fillStyle='#30383b';ctx.fillRect(0,0,512,512);
 fetch(`https://tiles.basemaps.cartocdn.com/vectortiles/carto.streets/v1/${coords.z}/${coords.x}/${coords.y}.mvt`).then(r=>{if(!r.ok)throw Error();return r.arrayBuffer();}).then(b=>{const tile=new VectorTile(new Pbf(new Uint8Array(b)));const draw=(name:string,color:string,stroke=false,width=1)=>{const layer=tile.layers[name];if(!layer)return;for(let i=0;i<layer.length;i++){const f=layer.feature(i);const geometry=f.loadGeometry();const k=512/layer.extent;ctx.beginPath();for(const ring of geometry){ring.forEach((p,j)=>j===0?ctx.moveTo(p.x*k,p.y*k):ctx.lineTo(p.x*k,p.y*k));if(f.type===3)ctx.closePath();}if(stroke){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}else{ctx.fillStyle=color;ctx.fill('evenodd');}}};
 draw('landcover','#2b3833');draw('park','#293b35');draw('water','#1d2529');draw('waterway','#1d2529',true,2);draw('building','#354043');draw('boundary','#202a2c',true,.8);draw('transportation','#121b1e',true,1.2);
 const labels=tile.layers.place;if(labels&&coords.z>=10){ctx.font='500 21px Arial';ctx.fillStyle='#81908e';ctx.textAlign='center';for(let i=0;i<labels.length;i++){const f=labels.feature(i);if(!['suburb','neighbourhood','quarter','borough'].includes(String(f.properties.class)))continue;const p=f.loadGeometry()[0]?.[0];if(!p)continue;const name=String(f.properties['name:en']||f.properties.name||'');ctx.fillText(name,p.x*512/labels.extent,p.y*512/labels.extent);}}done(undefined,canvas);
 }).catch(()=>done(undefined,canvas));return canvas;}
}
export class Map{
 l:L.Map;sources:Record<string,any>={};layers:L.Layer[]=[];
 constructor(o:any){this.l=L.map(o.container,{zoomControl:false,attributionControl:false,dragging:false,scrollWheelZoom:false,doubleClickZoom:false,boxZoom:false,touchZoom:false,keyboard:false,zoomSnap:.1,zoomAnimation:true}).setView(latLng(o.center),o.zoom);new InkTiles({maxZoom:19,minZoom:3,keepBuffer:2}).addTo(this.l);L.control.attribution({prefix:false}).addAttribution('© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>').addTo(this.l);
 L.marker([40.7812,-73.9665],{interactive:false,keyboard:false,icon:L.divIcon({className:'park-label',html:'CENTRAL<br/>PARK',iconSize:[70,30]})}).addTo(this.l);L.marker([40.6605,-73.969],{interactive:false,keyboard:false,icon:L.divIcon({className:'park-label',html:'PROSPECT<br/>PARK',iconSize:[70,30]})}).addTo(this.l);
 }
 fitBounds(b:[Point,Point],o:any){const padding=typeof o.padding==='number'?[o.padding,o.padding]:[o.padding.left,o.padding.top];this.l.fitBounds(L.latLngBounds(latLng(b[0]),latLng(b[1])),{padding:L.point(padding[0],padding[1]),animate:!!o.duration});return this;}
 on(event:string,fn:any){if(event==='load'){setTimeout(fn,0);return this;}this.l.on(event,fn);return this;}
 off(event:string,fn:any){this.l.off(event,fn);return this;}
 project(p:Point){return this.l.latLngToContainerPoint(latLng(p));}
 getBounds(){const b=this.l.getBounds();return {contains:(p:Point)=>b.contains(latLng(p))};}
 addSource(id:string,o:any){this.sources[id]=o.data;}
 addLayer(o:any){const data=this.sources[o.source];if(o.type==='circle'){const layer=L.geoJSON(data,{pointToLayer:(_feature,latlng)=>L.circleMarker(latlng,{radius:2.8,color:'#101416',weight:1.3,fillColor:'#fff',fillOpacity:1,interactive:false})}).addTo(this.l);this.layers.push(layer);return;}const mode=o.id.includes('ferry')?'ferry':'subway';const l=L.geoJSON(data,{filter:f=>f.properties?.mode===mode,style:f=>({color:f?.properties?.color??'#4b5354',weight:mode==='ferry'?1.3:2.2,opacity:mode==='ferry'?.85:.95,dashArray:mode==='ferry'?'2 6':undefined}),interactive:false}).addTo(this.l);this.layers.push(l);}
 remove(){this.l.remove();}
 get dragPan(){return this.l.dragging;}get scrollZoom(){return this.l.scrollWheelZoom;}get doubleClickZoom(){return this.l.doubleClickZoom;}get keyboard(){return this.l.keyboard;}get touchZoomRotate(){return {enable:()=>this.l.touchZoom.enable(),disable:()=>this.l.touchZoom.disable(),disableRotation:()=>{}};}
}
export class Marker{
 l:L.Marker;el:HTMLElement;
 constructor(o:any){this.el=o.element;this.l=L.marker([0,0],{icon:L.divIcon({html:this.el,className:'vehicle-holder',iconSize:[29,29],iconAnchor:[14.5,14.5]}),keyboard:false,zIndexOffset:this.el.classList.contains('ferry-terminal')?-10000:10000});}
 setLngLat(p:Point|{lng:number;lat:number}){this.l.setLatLng(Array.isArray(p)?latLng(p):[p.lat,p.lng]);return this;}
 getLngLat(){return this.l.getLatLng();}getElement(){return this.el;}addTo(m:Map){this.l.addTo(m.l);return this;}remove(){this.l.remove();}
}
export class Popup{
 l:L.Popup;constructor(){this.l=L.popup({closeButton:false,autoClose:false,closeOnClick:false,autoPan:false,offset:[0,-20],maxWidth:330,className:'ink-popup'});}
 setLngLat(p:Point|{lng:number;lat:number}){this.l.setLatLng(Array.isArray(p)?latLng(p):[p.lat,p.lng]);this.clamp();return this;}
 clamp(){const el=this.l.getElement();if(!el)return;el.style.translate='0px 0px';const r=el.getBoundingClientRect();const dx=r.left<12?12-r.left:r.right>innerWidth-12?innerWidth-12-r.right:0;const dy=r.top<12?12-r.top:r.bottom>innerHeight-12?innerHeight-12-r.bottom:0;el.style.translate=`${dx}px ${dy}px`;}
 setHTML(s:string){this.l.setContent(s);this.clamp();return this;}addTo(m:Map){this.l.openOn(m.l);this.clamp();return this;}getElement(){return this.l.getElement()!;}remove(){this.l.remove();}
}
