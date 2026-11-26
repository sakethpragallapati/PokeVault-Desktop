from PIL import Image
import numpy as np, json, base64, os, shutil
from shapes import *
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'wwwroot', 'assets', 'meadow')
os.makedirs(OUT,exist_ok=True)
walk=np.load('walk.npy'); water=np.load('water.npy')
CELL=4; G=1254//CELL+1
def grid(m):
    g=np.zeros((G,G),bool)
    ys=np.minimum(np.arange(G)*CELL+CELL//2,1253)
    g=m[np.ix_(ys,ys)]
    return base64.b64encode(np.packbits(g.astype(np.uint8),bitorder='little').tobytes()).decode()
im=np.asarray(Image.open('map.webp').convert('RGB')).astype(np.float32)
ground=np.array([113,192,83.])
blade=np.sqrt(((im-ground)**2).sum(-1))>45
cells=[]
CW,CH=21,20
for (x0,y0,x1,y1) in GRASS:
    for y in range(y0,y1,CH):
        for x in range(x0,x1,CW):
            xe,ye=min(x+CW,x1,1254),min(y+CH,y1,1254)
            blk=(slice(y,ye),slice(x,xe))
            if (xe-x)<8 or (ye-y)<8: continue
            if walk[blk].mean()<0.6: continue
            if blade[blk].mean()<0.45: continue
            cells.append([x,y,xe-x,ye-y])
print('grass cells',len(cells))
# player atlas
p=Image.open('player_rgba.png')
FX0,FY0,FW,FH=45,30,165,226
atlas=Image.new('RGBA',(FW*4,FH*4),(0,0,0,0))
for r in range(4):
    for c in range(4):
        atlas.paste(p.crop((c*256+FX0,r*256+FY0,c*256+FX0+FW,r*256+FY0+FH)),(c*FW,r*FH))
atlas.save(os.path.join(OUT,'player.png'),optimize=True)
anchors=[[126-FX0,247-FY0],[128-FX0,247-FY0],[126-FX0,241-FY0],[128-FX0,241-FY0]]
shutil.copy('map.webp',os.path.join(OUT,'map.webp'))
data={
 'size':1254,'cell':CELL,'grid':G,'walk':grid(walk),'water':grid(water),
 'pxPerMeter':34, 'tiles':[l.strip() for l in open('tiles.txt') if l.strip()], 'tileCount':32,'spawn':SPAWN,'grass':cells,'stones':STONES,
 'waterfall':WATERFALL,'river':RIVER,'waterRocks':WATER_ROCKS,
 'player':{'frameW':FW,'frameH':FH,'anchors':anchors,'heightPx':205,'rows':['down','left','right','up'],'heightM':1.75},
}
json.dump(data,open(os.path.join(OUT,'map.json'),'w'),separators=(',',':'))
print('json bytes',os.path.getsize(os.path.join(OUT,'map.json')),'atlas',atlas.size)
