import json
from pathlib import Path
D=json.loads(Path('data/transit.json').read_text());shapes={};terminals={};stations={}
for trip in D['trips']:
 route=trip[1];mode=D['routes'][route][2];code=D['routes'][route][0]
 if mode=='ferry' and code in ['RES','RWS']:continue # GTFS route_type=3: connecting buses, not boats.
 shapes.setdefault(trip[4],{'mode':mode,'route':code})
 if mode=='subway':
  for stop,*_ in D['patterns'][trip[5]]:
   parent=stop[:-1] if stop[-1:] in ['N','S'] else stop
   name,lng,lat=D['stops'].get(parent,D['stops'][stop])
   stations.setdefault(parent,{'id':parent,'name':name,'lng':lng,'lat':lat})
 if mode!='ferry':continue
 for stop,*_ in D['patterns'][trip[5]]:
  name,lng,lat=D['stops'][stop]
  # Feed duplicates for direction/trip variants share a physical landing.
  key=next((k for k,v in terminals.items() if ((v['lng']-lng)*.76)**2+(v['lat']-lat)**2<(60/111000)**2),stop)
  point=terminals.setdefault(key,{'id':stop,'name':name,'lng':lng,'lat':lat,'routes':[]})
  if code not in point['routes']:point['routes'].append(code)
for point in terminals.values():point['routes'].sort()
Path('public/data/route-meta.json').write_text(json.dumps({'shapes':shapes,'terminals':list(terminals.values()),'stations':list(stations.values())},separators=(',',':')))
print(len(shapes),'shape styles;',len(terminals),'ferry landings')
