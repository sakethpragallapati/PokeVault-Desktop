from PIL import Image, ImageDraw
import numpy as np, json, base64
from scipy import ndimage as ndi
from shapes import *
W=H=1254
im=Image.open('map.webp').convert('RGB'); a=np.asarray(im).astype(np.float32)/255
r,g,b=a[...,0],a[...,1],a[...,2]
mx=a.max(-1); mn=a.min(-1); d=np.maximum(mx-mn,1e-6)
h=np.where(mx==r,((g-b)/d)%6,np.where(mx==g,(b-r)/d+2,(r-g)/d+4))*60
water=(b>g+0.03)&(b>r+0.12)&(h>185)&(h<230)
fallpoly=Image.new('L',(W,H),0); dr=ImageDraw.Draw(fallpoly)
dr.polygon(WATERFALL['fall'],fill=1); dr.polygon(WATERFALL['top'],fill=1)
cx,cy,rx,ry=WATERFALL['basin']; dr.ellipse((cx-rx,cy-ry,cx+rx,cy+ry),fill=1)
water|=np.asarray(fallpoly).astype(bool)
water=ndi.binary_closing(water,iterations=2)
water=ndi.binary_opening(water,iterations=1)
for (rx_,ry_) in WATER_ROCKS:
    water|=((np.mgrid[0:H,0:W][1]-rx_)**2/24**2+(np.mgrid[0:H,0:W][0]-ry_)**2/18**2)<=1
# the bridge deck is not water
water[622:758,574:658]=False
solid=Image.new('L',(W,H),0); ds=ImageDraw.Draw(solid)
for p in list(POLYS.values())+list(POLYS2.values()): ds.polygon(p,fill=1)
for (cx,cy,rx,ry) in ELLIPSES.values(): ds.ellipse((cx-rx,cy-ry,cx+rx,cy+ry),fill=1)
for (x0,y0,x1,y1) in RECTS.values(): ds.rectangle((x0,y0,x1,y1),fill=1)
solid=np.asarray(solid).astype(bool)
stones=np.zeros((H,W),bool)
yy,xx=np.mgrid[0:H,0:W]
for path in STONES:
    for (sx,sy) in path: stones|=((xx-sx)**2/14**2+(yy-sy)**2/9**2)<=1
    for (ax,ay),(bx,by) in zip(path,path[1:]):   # walkable strip between stones
        n=20
        for t in np.linspace(0,1,n):
            px,py=ax+(bx-ax)*t,ay+(by-ay)*t; stones|=((xx-px)**2+(yy-py)**2)<=8**2
walk=~solid&~water|stones
walk[stones]=True
np.save('walk.npy',walk); np.save('water.npy',water&~stones)
# reachability: feet need a little room (radius 4)
er=ndi.binary_erosion(walk,iterations=4)
lab,n=ndi.label(er)
sx,sy=SPAWN
main=lab[sy,sx]
sizes=ndi.sum(er,lab,range(1,n+1))
iso=[(i+1,int(s)) for i,s in enumerate(sizes) if i+1!=main and s>300]
print('components',n,'main size',int(sizes[main-1]),'isolated (>300px):',len(iso))
sl=ndi.find_objects(lab)
for i,s in iso: print('  isolated',i,s,'x',sl[i-1][1].start,sl[i-1][1].stop,'y',sl[i-1][0].start,sl[i-1][0].stop)
vis=np.asarray(im).copy()
ov=np.zeros_like(vis)
ov[solid]=(255,0,0); ov[water]=(0,80,255); ov[stones]=(255,255,0)
iso_mask=np.isin(lab,[i for i,_ in iso])
ov[iso_mask]=(255,0,255)
for (x0,y0,x1,y1) in GRASS: ov[y0:y1,x0:x1][~solid[y0:y1,x0:x1]&~water[y0:y1,x0:x1]]=(0,255,120)
m=(ov.sum(-1)>0)
vis[m]=(vis[m]*0.45+ov[m]*0.55).astype(np.uint8)
Image.fromarray(vis).save('overlay.png')
