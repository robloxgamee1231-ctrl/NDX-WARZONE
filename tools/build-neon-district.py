"""Neon District — original NDX Combat arena, authored with Blender 4.2 Python.

Run: blender -b --python tools/build-neon-district.py
Writes an editable source scene, an uncompressed interchange GLB in out/, and
collision/navigation metadata. Use npm run assets:neon to compress the web GLB.
The helper coordinates are metres in the game/Godot (+Y up, -Z north).
"""
import json
import math
import random
import struct
from pathlib import Path
import zlib

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'out/ndx-assets'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE = ROOT / 'assets-source/maps/neon-district.blend'
SOURCE.parent.mkdir(parents=True, exist_ok=True)
DATA = ROOT / 'src/game/neon-district.json'
random.seed(6803)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.world = bpy.data.worlds.new('Blue hour')
scene.world.color = (0.075, 0.092, 0.15)
parts = []
solids = []

def rgb(hexstr):
    values = (int(hexstr[i:i+2], 16) / 255 for i in (0, 2, 4))
    return tuple(c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in values)


def texture(name, grit, seam, tint):
    """Deterministic original 256 px tiling packed luminance texture."""
    rng = random.Random(name)
    size = 256
    pixels = bytearray()
    red,green,blue=(int(tint[i:i+2],16) for i in (0,2,4))
    for y in range(size):
        pixels.append(0)
        for x in range(size):
            wave = (math.cos(x*math.tau/size*3 + math.sin(y*math.tau/size)*1.4) + math.sin(y*math.tau/size*4))*.5
            seamshade = 0
            if seam == 'tiles' and (y%64<=2 or ((x+(y//64%2)*64)%128<=2)):
                seamshade = 47
            if seam == 'flutes':
                seamshade = 58*max(0,math.cos(x*math.tau/size*28))**9
            value = int(max(65, min(255, 211 + 17*wave + rng.gauss(0,grit) - seamshade)))
            pixels.extend((value*red//235,value*green//235,value*blue//235))
    def chunk(kind, value):
        return struct.pack('>I',len(value))+kind+value+struct.pack('>I',zlib.crc32(kind+value))
    path = OUT / (name+'.png')
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,2,0,0,0))+
                     chunk(b'IDAT',zlib.compress(pixels,9))+chunk(b'IEND',b''))
    image = bpy.data.images.load(str(path))
    image.pack()
    return image


def mat(name, color, rough=.72, metal=0, emit=0, tex=None):
    m=bpy.data.materials.new(name)
    m.diffuse_color=(*rgb(color),1)
    m.use_nodes=True
    m.use_backface_culling=True
    shader=m.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value=m.diffuse_color
    shader.inputs['Roughness'].default_value=rough
    shader.inputs['Metallic'].default_value=metal
    if emit:
        shader.inputs['Emission Color'].default_value=m.diffuse_color
        shader.inputs['Emission Strength'].default_value=emit
    if tex:
        image=m.node_tree.nodes.new('ShaderNodeTexImage')
        image.image=texture(name.split(' / ')[-1],*tex,color)
        m.node_tree.links.new(image.outputs['Color'], shader.inputs['Base Color'])
    return m


asphalt=(14,'none')
cladding=(5,'tiles')
fluted=(4,'flutes')
M={
    'road':mat('Asphalt / blue carbon','404656',.92,tex=asphalt),
    'paving':mat('Terrazzo / warm granite','8a7981',.86,tex=asphalt),
    'stone':mat('Glazed ceramic / salt slate','5a677c',.79,tex=cladding),
    'slate':mat('Nickel cladding / midnight','303746',.52,.53,tex=fluted),
    'blue':mat('Railway paint / pacific','3c7985',.59,.22,tex=fluted),
    'pink':mat('Kiln enamel / ember','985757',.54,.22,tex=fluted),
    'warm':mat('Plaza stone / copper sand','a17a69',.77,tex=cladding),
    'iron':mat('Anodized metal / coal','252938',.46,.55),
    'satin':mat('Brushed aluminum','7694a2',.41,.54),
    'glass':mat('Laminated glass / violet','25364e',.28,.56,.12),
    'leaf':mat('Courtyard / succulent','4b8378',.89),
    'line':mat('Lane paint / almond','d3c4a1',.8),
    'mark':mat('Safety paint / cayenne','db7e5a',.71),
    'cyan':mat('LED / ion blue','65e1ff',.36,emit=2.5),
    'coral':mat('LED / persimmon','ff795b',.41,emit=2.3),
    'cream':mat('LED / opal','ffe7b3',.42,emit=1.4),
}


def zone(name):
    c=bpy.data.collections.new(name)
    scene.collection.children.link(c)
    return c


def xyz(x,y,z):
    return (x,-z,y)


def mesh(name, coordinates, faces, material):
    data=bpy.data.meshes.new(name)
    data.from_pydata([xyz(*p) for p in coordinates],[],faces)
    data.update()
    uv=data.uv_layers.new(name='UV Exchange').data
    for face in data.polygons:
        normal=face.normal
        axis=max(range(3),key=lambda i:abs(normal[i]))
        a,b=((1,2),(0,2),(0,1))[axis]
        for loop in face.loop_indices:
            co=data.vertices[data.loops[loop].vertex_index].co
            uv[loop].uv=(co[a]*.24,co[b]*.24)
    obj=bpy.data.objects.new(name,data)
    area.objects.link(obj)
    obj.data.materials.append(M[material])
    parts.append(obj)
    return obj


def prism(name, outline, y, h, material):
    n=len(outline)
    verts=[(x,t,z) for t in (y,y+h) for x,z in outline]
    faces=[tuple(range(n)),tuple(reversed(range(n,n*2)))]+[(i,i+n,(i+1)%n+n,(i+1)%n) for i in range(n)]
    return mesh(name,verts,faces,material)


def box(name,x,y,z,w,h,d,material,collision=None,corner=0):
    a,b,c,e=x-w/2,x+w/2,z-d/2,z+d/2
    t=min(corner,w*.2,d*.2)
    outline=[(a+t,c),(b-t,c),(b,c+t),(b,e-t),(b-t,e),(a+t,e),(a,e-t),(a,c+t)] if t else [(a,c),(b,c),(b,e),(a,e)]
    obj=prism(name,outline,y,h,material)
    if collision:
        solids.append([collision,*[round(q,4) for q in (x,y,z,w,h,d)]])
    return obj


def drum(name,x,y,z,rx,rz,height,material,facets=12):
    return prism(name,[(x+rx*math.cos(i*math.tau/facets),z+rz*math.sin(i*math.tau/facets)) for i in range(facets)],y,height,material)


def beam(name,p,q,width,material):
    a,b=Vector(xyz(*p)),Vector(xyz(*q))
    length=(b-a).length
    # Build a local box with a shared UV scale, then orient along the span.
    obj=box(name,0,-length/2,0,width,length,width,material)
    obj.location=(a+b)*.5
    obj.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    return obj


def text(label,x,y,z,size,material,face=1,floor=False):
    data=bpy.data.curves.new(label,'FONT')
    data.body=label
    data.align_x='CENTER'
    data.size=size
    data.space_character=1.16
    data.resolution_u=2
    data.extrude=0
    obj=bpy.data.objects.new(label,data)
    area.objects.link(obj)
    obj.location=xyz(x,y,z)
    angle={1:0,-1:math.pi,2:math.pi/2,-2:-math.pi/2}[face]
    obj.rotation_euler=(0,0,0) if floor else (math.pi/2,0,angle)
    obj.data.materials.append(M[material])
    parts.append(obj)
    return obj


def crates(x,z,tone):
    box('Chamfered insulated transport case',x,0,z,2.6,1.25,1.72,tone,'concrete',.21)
    for y,h in [(0,.11),(1.08,.17)]:
        box('Cast end wrap',x,y,z,2.65,h,1.77,'iron',corner=.2)
    for s in [-1,1]:
        for dx in [-.83,.83]:
            box('Recessed rail latch',x+dx,.45,z+s*.875,.25,.4,.06,'satin',corner=.04)
        text('NDX  //  CARGO',x,.78,z+s*.873,.20,'line',s)
        box('Case telemetry',x,.27,z+s*.88,.55,.055,.037,'cream')
    for dx in [-.75,0,.75]:
        box('Compression rib',x+dx,1.25,z,.06,.036,1.62,'satin')


def kiosk(x,z,team):
    neon='cyan' if team==0 else 'coral'
    paint='blue' if team==0 else 'pink'
    label='ASTER' if team==0 else 'EMBER'
    box('Folded vendor chassis',x,0,z,4.4,2.6,3.45,'slate','concrete',.32)
    box('Inset vent fascia',x,1.17,z+1.737,3.45,1.24,.09,paint,corner=.11)
    box('Splayed canopy',x,2.56,z+.27,4.86,.23,4.42,paint,corner=.35)
    box('LED & awning trim',x,2.57,z+2.477,4.24,.08,.038,neon)
    for d in [-1,1]:
        text(label+' / ACCESS',x,2.13,z+d*1.793,.36,'cream',d)
        box('White counter insert',x,.99,z+d*1.791,3.43,.105,.24,'satin',corner=.11)
        for dx in [-1.62,-1.46,1.46,1.62]:
            box('Shutter fin',x+dx,.27,z+d*1.748,.064,.89,.08,'satin')
    for dx in [-1.9,1.9]:
        box('Kiosk bollard stem',x+dx,0,z+2.95,.14,.76,.14,'iron')
        drum('Polymer bollard cap',x+dx,.68,z+2.95,.16,.16,.13,neon)


def building(x,z,width,depth,height,neon,paint,title,face=1,solid=True):
    box(title+' / masonry mass',x,0,z,width,height,depth,'stone','concrete' if solid else None,.16)
    box('Sloped trim / upper lip',x,height-.23,z,width+.46,.29,depth+.31,'iron',corner=.2)
    box('Plinth',x,.06,z,width+.18,.3,depth+.18,'iron',corner=.15)
    for j in range(1,round(height/2.35)+1):
        level=j*2.14-.9
        if level+1.08>height-.22:
            break
        for d in [-1,1]:
            for k in range(int(width//2.1)):
                px=x+((k+.5)/int(width//2.1)-.5)*(width-.4)
                zz=z+d*(depth/2+.043)
                box('Recess framed glass',px,level,zz,1.33,1.09,.104,'iron',corner=.045)
                box('Violet envelope glass',px,level+.088,zz+d*.058,1.17,.91,.034,'glass')
                if (j*7+k+(d+1))%4==0:
                    box('Backlit window slot',px,level+.27,zz+d*.08,1.06,.04,.022,neon)
                box('Mullion',px,level+.085,zz+d*.09,.068,.92,.039,'satin')
    for d in [-1,1]:
        for dx in [-width*.43,width*.43]:
            box('Exposed riser',x+dx,0,z+d*(depth/2+.1),.1,height-.39,.17,'satin')
            for h in [.38,1.13,height-.58]:
                box('Riser fixing',x+dx,h,z+d*(depth/2+.17),.188,.058,.105,'iron')
    zf=z+face*(depth/2+.136)
    box('Folded fascia / tenant ID',x,height-.94,zf,width*.8,.54,.19,paint,corner=.08)
    text(title,x,height-.77,zf+face*.112,.34 if width<9 else .56,'cream',face)
    box('Tenant underline',x,height-.949,zf+face*.11,width*.72,.042,.028,neon)
    for dx in [-width*.26,width*.24]:
        drum('HVAC finned casing',x+dx,height,z+.22,.72,.65,.67,'slate',10)
        drum('HVAC extractor cap',x+dx,height+.66,z+.22,.75,.68,.12,'iron',10)
        for j in range(5):
            box('Extractor grille',x+dx-.42+j*.21,height+.78,z+.22,.068,.033,.91,'satin')


def relay_decal(x,z,mark):
    drum('Transit circle',x,.006,z,2.73,2.73,.012,'slate',32)
    for i in range(24):
        a=i*math.tau/24
        box('Transit circuit strip',x+math.cos(a)*2.53,.02,z+math.sin(a)*2.53,.12,.01,.12,'cyan' if i%3 else 'cream')
    text(mark,x,.035,z+.46,1.42,'line',floor=True)


area=zone('00 - Roads and transit art')
box('Asphalt city block',0,-.45,0,118,.45,113,'road')
for z in [-23,0,23]:
    for x in range(-38,40,4):
        box('Taxi lane inset',x,.004,z,2.28,.012,.092,'line')
    for x in [-32,32]:
        for d in range(6):
            box('Crosswalk inlay',x,.012,z-2.5+d,.88,.012,.51,'paving')
for x in [-27,27]:
    for z in [-13,13]:
        box('Zoned sidewalk inlay',x,.018,z,14,.037,11,'paving',corner=1.6)
for x,z,label in [(-24,1,'A'),(0,0,'B'),(24,-1,'C')]:
    relay_decal(x,z,label)
for x in [-13,13]:
    for z in [-30,31]:
        text('ONE WAY   / /',x,.021,z,.59,'line',floor=True)

for team,side,label in [(0,-1,'ASTER'),(1,1,'EMBER')]:
    neon='cyan' if team==0 else 'coral'
    paint='blue' if team==0 else 'pink'
    area=zone(f'0{team+1} - {label.title()} courtyards')
    box('Boundary return',side*43,0,0,1.18,6,76,'slate','dark')
    for z in [-27,-8,10,27]:
        xx=side*42.38
        box('Perimeter service post',xx,0,z,.72,4.1,.92,'stone',corner=.11)
        box('Service post pulse',xx,2.26,z,.76,.065,.96,neon)
        box('Wayfinding crest',side*41.9,2.7,z,.17,.92,1.46,paint)
    # Opposing courtyards are deliberately playable mirror layouts.
    for z in [-13,13]:
        building(side*23.8,z,12.6,9,6.15,neon,paint,f'{label} / {"PLATFORMS" if z<0 else "SERVICE"}',1 if z<0 else -1)
        outer=side*30.17
        box('Folded side-panel marquee',outer,2.13,z,.18,1.04,6.35,paint,corner=.07)
        text(f'{label}  //  16',outer+side*.101,2.48,z,.54,'cream',2*side)
        box('Marquee underlight',outer+side*.117,2.21,z,.062,.073,6.26,neon)
        for f in [-1,1]:
            box('Fascia brace',outer+.04*side,1.87,z+2.88*f,.32,.26,.14,'iron')
    kiosk(side*11,1.8 if team==0 else -1.8,team)
    crates(side*33.25,-5.2,paint)
    crates(side*34.25,6.2,paint)
    for z in [-20,20]:
        # Rounded planters form offset cover without sealing either exit.
        box('Rounded stormwater planter',side*32.6,0,z,3.65,.92,1.26,'warm','concrete',.21)
        box('Tumbled stone capping',side*32.6,.79,z,3.77,.17,1.39,'stone',corner=.21)
        for q in range(7):
            xx=side*32.6+(q-3)*.43
            drum('Coastal planting / crown',xx,.86,z,.31,.27,.39+random.random()*.28,'leaf',7)
    for z in [-33.8,34.6]:
        building(side*24.5,z,24.0,6.7,9.2+(2.1 if z*side>0 else 0),neon,paint,
                 f'{label} / EXCHANGE',1 if z<0 else -1)
    for z in [-24,22]:
        crates(side*7.7,z,'slate')
        x=side*19.1
        offset=z+(-2.6 if z>0 else 2.6)
        # Lightweight district gateway, tall enough for players to run under.
        box('Cantilever footing',x,0,offset,.62,.22,.51,'stone')
        box('Signal gantry upright',x,0,offset,.27,4.76,.28,'iron','dark',.035)
        box('Overhead terminal blade',x,4.13,z,.23,.63,3.9,paint,corner=.09)
        box('Terminal guide light',x+side*.139,4.19,z,.081,.065,3.86,neon)
        text('16 / LOOP',x+side*.129,4.37,z,.32,'cream',2*side)
        box('Vertical LED trace',x+side*.16,1.3,offset,.065,2.66,.078,neon)

area=zone('03 - Skybridge and market gallery')
box('Central pedestrian skybridge',0,3.07,-9.9,20,0.37,4.4,'stone','concrete',.1)
for x in [-7.8,7.8]:
    for z in [-11.38,-8.42]:
        box('Bridge stanchion',x,0,z,.49,3.1,.48,'iron','dark',.07)
        box('Stanchion foot',x,0,z,.85,.24,.8,'satin',corner=.06)
for z in [-12.16,-7.64]:
    box('Skybridge mesh railing',0,3.44,z,20,.86,.11,'iron','dark')
    box('Opal handrail',0,4.3,z,20,.085,.16,'cyan',corner=.037)
    box('Bridge ribbon below',0,3.09,z,19.7,.065,.085,'coral')
    for dx in range(-9,10):
        box('Rail cast grille',dx,3.55,z,.09,.64,.15,'satin')
for side in [-1,1]:
    for i in range(12):
        y=(i+1)*3.44/12
        x=side*(17.242-(i+.5)*.604)
        box('Cast terrazzo stair / tread',x,0,-9.9,.607,y,3.76,'stone','concrete')
        box('Tactile insert',x+side*.22,y-.012,-9.9,.043,.016,3.57,'cream')
    for z in [-11.94,-7.86]:
        beam('Inclined wire rail',(side*17.3,.93,z),(side*9.92,4.38,z),.09,'satin')
        for j in [0,4,8,11]:
            x=side*(17.24-j*.604)
            box('Inclined rail mount',x,(j+1)*3.44/12,z,.1,.94,.12,'iron')
text('NEON  DISTRICT',0,3.18,-7.58,.45,'cream')
text('TRANSFER  16',0,3.18,-12.22,.45,'cream',-1)

box('Market canopy / folded metal',0,4.65,14.1,17.26,.37,8.8,'slate','dark',.44)
for x in [-7.4,7.4]:
    for z in [10.6,17.4]:
        box('Market load column',x,0,z,.54,4.67,.53,'iron','dark',.08)
        box('Ceramic impact jacket',x,0,z,.84,1.38,.79,'pink','concrete',.12)
        box('Floor strip light',x,1.39,z,.87,.095,.83,'cream')
for z in [9.66,18.56]:
    box('Canopy neon channel',0,4.63,z,16.15,.096,.092,'coral')
    box('Gallery fascia',0,4.04,z,7.6,.66,.14,'blue',corner=.076)
    side=1 if z>14 else -1
    text('NIGHT / MARKET',0,4.24,z+side*.086,.54,'cream',side)
for x in [-4.0,4.0]:
    z=14.62 if x<0 else 13.25
    box('Market fixture with corner guards',x,0,z,3.41,1.15,1.49,'warm','concrete',.21)
    box('Ceramic serving ledge',x,1.08,z,3.51,.114,1.57,'satin',corner=.21)
    for i in range(6):
        box('Market display bin',x-1.2+i*.46,1.18,z,.36,.19,.64,'pink' if i%2 else 'blue',corner=.06)

area=zone('04 - Perimeter skyline and guideways')
for z in [-39,39]:
    box('Perimeter slab',0,0,z,86.8,3.4,.9,'stone','concrete')
    box('Wall rail',0,3.37,z,86.8,.15,1.12,'iron')
    for x in range(-40,41,5):
        box('Tram wayfinding marker',x,2.64,z,1.25,.09,1.02,'cyan' if z<0 else 'coral')
for i,x in enumerate(range(-52,53,15)):
    z=-49-random.random()*3
    building(x,z,10+random.random()*2,7,12+random.random()*12,'cyan' if i%2 else 'coral','slate','NDX' if i%2 else '16',1,False)
for z in [-35,-17,1,19,37]:
    for x in [-50,50]:
        box('Distant office silhouette',x,0,z,7+random.random()*2,11+random.random()*12,11,'slate')
        for i in range(5):
            box('High window band',x,.45+i*1.89,z+5.51,3.47,.16,.038,'glass' if i%2 else 'cyan')

# Authoring metadata lives in the blend, in addition to the exported JSON.
spawns=[]
for side in [-1,1]:
    for x,z in [(37.4,-24.4),(36.6,-13.2),(37.75,-8.2),(39.0,0.35),(37.9,10.1),(36.4,16.1),(37.1,25.1),(17.55,30.4),(16.7,-29.0)]:
        spawns.append({'x':x*side,'z':z,'yaw':round(side*math.pi/2,5)})
relays=[{'id':'A','title':'Aster Concourse','x':-24,'z':1},
        {'id':'B','title':'District Crossing','x':0,'z':0},
        {'id':'C','title':'Ember Concourse','x':24,'z':-1}]
meta=zone('05 - Spawn and relay locators (not rendered)')
for name,item in [(f'Spawn {i+1:02}',p) for i,p in enumerate(spawns)]+[(r['title'],r) for r in relays]:
    empty=bpy.data.objects.new(name,None)
    empty.location=xyz(item['x'],0,item['z'])
    empty.empty_display_type='ARROWS'
    empty.rotation_euler.z=-item.get('yaw',0)
    meta.objects.link(empty)
DATA.write_text(json.dumps({'solids':solids,'spawns':spawns,'relays':relays},indent=2)+'\n')

# Save art first: hundreds of independently editable props with named materials,
# packed textures, selected framing camera and no hidden runtime dependency.
view=zone('06 - Authoring preview camera & lights')
camera=bpy.data.objects.new('Exchange overview',bpy.data.cameras.new('Exchange overview'))
view.objects.link(camera)
camera.location=xyz(56,45,52)
camera.rotation_euler=(Vector((0,0,0))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.lens=40
scene.camera=camera
for name,position,power,color in [('Blue-hour key',(-14,30,-12),55000,(.46,.65,1)),('Warm forecourt',(15,21,13),26000,(1,.49,.33))]:
    data=bpy.data.lights.new(name,'AREA'); data.energy=power; data.color=color; data.shape='DISK'; data.size=25
    light=bpy.data.objects.new(name,data); view.objects.link(light); light.location=xyz(*position)
    light.rotation_euler=(Vector((0,0,0))-light.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE),compress=True)

# Export consolidated render meshes by sector. Source keeps every object.
for target in [c for c in scene.collection.children if c.name[:2] in ('00','01','02','03','04')]:
    bpy.ops.object.select_all(action='DESELECT')
    for obj in list(target.objects):
        obj.select_set(True)
    bpy.context.view_layer.objects.active=next(iter(target.objects))
    bpy.ops.object.convert(target='MESH')
    bpy.ops.object.join()
    bpy.context.object.name=target.name[5:]
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
for obj in bpy.context.selected_objects:
    obj.select_set(False)
for c in scene.collection.children:
    if c.name[:2] in ('00','01','02','03','04'):
        for obj in c.objects:
            obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'neon-district.glb'),export_format='GLB',use_selection=True,export_animations=False,export_image_format='JPEG',export_jpeg_quality=84)
print(f'Neon District: {SOURCE.stat().st_size:,} byte Blender source; {len(solids)} collision volumes and {len(spawns)} spawns.')
