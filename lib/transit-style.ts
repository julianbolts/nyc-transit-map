export type Mode='subway'|'ferry';
const SUBWAY:Record<string,string>={
 '1':'#EE352E','2':'#EE352E','3':'#EE352E','4':'#00933C','5':'#00933C','6':'#00933C','6X':'#00933C','7':'#B933AD','7X':'#B933AD',
 A:'#0039A6',C:'#0039A6',E:'#0039A6',B:'#FF6319',D:'#FF6319',F:'#FF6319',FX:'#FF6319',M:'#FF6319',G:'#6CBE45',J:'#996633',Z:'#996633',L:'#A7A9AC',N:'#FCCC0A',Q:'#FCCC0A',R:'#FCCC0A',W:'#FCCC0A',S:'#808183',GS:'#808183',FS:'#808183',H:'#808183',SI:'#0039A6',SIR:'#0039A6'
};
const FERRY:Record<string,{color:string;label:string;name:string}>={
 ER:{color:'#218A9A',label:'ER',name:'East River'},SB:{color:'#FFB000',label:'SBK',name:'South Brooklyn'},SBK:{color:'#FFB000',label:'SBK',name:'South Brooklyn'},AS:{color:'#FF6B00',label:'AST',name:'Astoria'},AST:{color:'#FF6B00',label:'AST',name:'Astoria'},RS:{color:'#4E008E',label:'RWS',name:'Rockaway–Soundview'},SG:{color:'#D0006F',label:'STG',name:'St. George'},STG:{color:'#D0006F',label:'STG',name:'St. George'},GI:{color:'#9795A0',label:'GOV',name:'Governors Island Shuttle'},GOV:{color:'#9795A0',label:'GOV',name:'Governors Island Shuttle'},RWS:{color:'#00A1E1',label:'RWS',name:'Rockaway West Shuttle'},RES:{color:'#00A1E1',label:'RES',name:'Rockaway East Shuttle'}
};
export function appearance(mode:Mode,route:string){if(mode==='ferry'){const info=FERRY[route]??{color:'#79929A',label:route,name:route};return {...info,text:'#ffffff',express:false};}const express=['6X','7X','FX'].includes(route);const label=express?route.slice(0,-1):['GS','FS','H'].includes(route)?'S':route==='SI'?'SIR':route;return {color:SUBWAY[route]??'#808183',label,name:route,text:['N','Q','R','W'].includes(route)?'#151a19':'#ffffff',express};}
// Dark, desaturated route hue for unobtrusive lines on the charcoal basemap.
export function mutedColor(hex:string){const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));const gray=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;return '#'+rgb.map((v,i)=>Math.round((v*.65+gray*.35)*.40+[29,36,39][i]*.60).toString(16).padStart(2,'0')).join('');}
export function headingBetween(a:[number,number],b:[number,number]){const angle=Math.atan2((b[0]-a[0])*Math.cos((a[1]+b[1])*Math.PI/360),b[1]-a[1])*180/Math.PI;return (angle+360)%360;}
export function unwrapHeading(previous:number|undefined,next:number){if(previous===undefined)return next;return previous+((next-previous+540)%360+360)%360-180;}
