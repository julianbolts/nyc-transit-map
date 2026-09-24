import csv,zipfile,json,io,datetime
from pathlib import Path
out={'sources':{},'stops':{},'routes':{},'trips':[],'calendars':{},'exceptions':{}}
shapes={}
for mode in ['subway','ferry']:
 z=zipfile.ZipFile('/tmp/'+mode+'.zip')
 def rows(name):
  try:return list(csv.DictReader(io.TextIOWrapper(z.open(name+'.txt'),encoding='utf-8-sig')))
  except KeyError:return []
 prefix=mode+':'
 out['sources'][mode]={'downloaded':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 for s in rows('stops'):out['stops'][prefix+s['stop_id']]=[s['stop_name'],float(s['stop_lon']),float(s['stop_lat'])]
 for r in rows('routes'):out['routes'][prefix+r['route_id']]=[r.get('route_short_name') or r['route_long_name'],r['route_long_name'],mode]
 for c in rows('calendar'):out['calendars'][prefix+c['service_id']]=[c['start_date'],c['end_date'],[int(c[d]) for d in ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']]]
 for c in rows('calendar_dates'):out['exceptions'].setdefault(prefix+c['service_id'],{})[c['date']]=int(c['exception_type'])
 sts={}
 def sec(t):
  h,m,s=map(int,t.split(':'));return h*3600+m*60+s
 for s in rows('stop_times'):
  sts.setdefault(s['trip_id'],[]).append([prefix+s['stop_id'],sec(s['arrival_time']),sec(s['departure_time']),int(s['stop_sequence'])])
 raw={}
 for s in rows('shapes'):raw.setdefault(s['shape_id'],[]).append([int(s['shape_pt_sequence']),float(s['shape_pt_lon']),float(s['shape_pt_lat'])])
 for key,pts in raw.items():shapes[prefix+key]=[[p[1],p[2]] for p in sorted(pts)]
 for t in rows('trips'):
  stops=sorted(sts.get(t['trip_id'],[]),key=lambda s:s[3])
  if not stops:continue
  out['trips'].append([prefix+t['trip_id'],prefix+t['route_id'],prefix+t['service_id'],t.get('trip_headsign',''),prefix+t.get('shape_id',''),stops])
Path('data/transit.json').write_text(json.dumps(out,separators=(',',':')))
Path('public/data/shapes.json').write_text(json.dumps(shapes,separators=(',',':')))
print(len(out['trips']),'trips',len(out['stops']),'stops',len(shapes),'shapes')
patterns={};templates=[]
for t in out['trips']:
 start=t[5][0][1]
 template=[[s[0],s[1]-start,s[2]-start,s[3]] for s in t[5]]
 key=json.dumps(template,separators=(',',':'))
 if key not in patterns:patterns[key]=len(templates);templates.append(template)
 t[5]=patterns[key];t.append(start)
out['patterns']=templates
Path('data/transit.json').write_text(json.dumps(out,separators=(',',':')))
print(len(templates),'unique timing patterns')
# Store each station-to-station geometry once; shape references carry direction.
shape_stops={}
for t in out['trips']:
 shape_stops.setdefault(t[4],set()).update(s[0] for s in out['patterns'][t[5]])
edges=[];edge_ids={};shape_refs={}
for shape,path in shapes.items():
 breaks={0:'point:'+str(path[0]),len(path)-1:'point:'+str(path[-1])}
 for stop in sorted(shape_stops.get(shape,[])):
  name,x,y=out['stops'][stop]
  i=min(range(len(path)),key=lambda i:((path[i][0]-x)*.76)**2+(path[i][1]-y)**2)
  node=stop[:-1] if stop.startswith('subway:') and stop[-1:] in ['N','S'] else stop
  breaks[i]=node
 order=sorted(breaks);refs=[]
 for a,b in zip(order,order[1:]):
  points=[[round(x,6),round(y,6)] for x,y in path[a:b+1]]
  origin,destination=breaks[a],breaks[b]
  reverse=origin>destination
  canonical=points[::-1] if reverse else points
  pair=sorted([origin,destination])
  key=json.dumps([pair,canonical],separators=(',',':'))
  if key not in edge_ids:
   edge_ids[key]=len(edges)+1;edges.append({'from':pair[0],'to':pair[1],'coordinates':canonical})
  refs.append(-edge_ids[key] if reverse else edge_ids[key])
 shape_refs[shape]=refs
Path('public/data/network.json').write_text(json.dumps({'edges':edges,'shapes':shape_refs},separators=(',',':')))
Path('public/data/shapes.json').unlink(missing_ok=True)
print(len(edges),'canonical edges; directions stored as signed references')
