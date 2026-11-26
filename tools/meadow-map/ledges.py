# Mark the brown dirt edges ("ledges") in tiles.txt as 'L': hoppable in any direction onto open ground.
from PIL import Image, ImageDraw
import numpy as np
from shapes import *
rows=[list(l.strip()) for l in open('tiles.txt') if l.strip()]
N=32; T=1254/N
im=np.asarray(Image.open('map.webp').convert('RGB')).astype(np.float32)/255
r,g,b=im[...,0],im[...,1],im[...,2]
mx=im.max(-1); mn=im.min(-1); d=np.maximum(mx-mn,1e-6)
h=np.where(mx==r,((g-b)/d)%6,np.where(mx==g,(b-r)/d+2,(r-g)/d+4))*60
s=np.where(mx>0,(mx-mn)/np.maximum(mx,1e-6),0)
brown=(h>12)&(h<45)&(s>0.3)&(mx<0.66)
# things that are not ledges: objects and trees (everything traced except the plain forest edges is fine to use)
obj=Image.new('L',(1254,1254),0); od=ImageDraw.Draw(obj)
for (x0,y0,x1,y1) in RECTS.values(): od.rectangle((x0,y0,x1,y1),fill=1)
for (cx,cy,rx,ry) in ELLIPSES.values(): od.ellipse((cx-rx,cy-ry,cx+rx,cy+ry),fill=1)
for p in list(POLYS.values())+list(POLYS2.values()): od.polygon(p,fill=1)
obj=np.asarray(obj).astype(bool)
water=np.load('water.npy')
out=[]
for y in range(N):
    for x in range(N):
        if rows[y][x] not in '#v': continue
        if x>=17 and y<=7: continue                      # cliff plateau faces stay walls
        sl=(slice(int(y*T),int((y+1)*T)),slice(int(x*T),int((x+1)*T)))
        if obj[sl].mean()>0.12 or water[sl].mean()>0.25: continue
        if brown[sl].mean()>0.10: rows[y][x]='L'; out.append((x,y))
open('tiles.txt','w').write('\n'.join(''.join(r) for r in rows)+'\n')
print(len(out), out)
