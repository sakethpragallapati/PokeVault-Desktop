# First guess at a 32x32 tile permission grid; the result is then corrected by hand in tiles.txt.
from PIL import Image
import numpy as np
from shapes import *
N=32; T=1254/N
im=np.asarray(Image.open('map.webp').convert('RGB')).astype(np.float32)/255
r,g,b=im[...,0],im[...,1],im[...,2]
mx=im.max(-1); mn=im.min(-1); d=np.maximum(mx-mn,1e-6)
h=np.where(mx==r,((g-b)/d)%6,np.where(mx==g,(b-r)/d+2,(r-g)/d+4))*60
s=np.where(mx>0,(mx-mn)/np.maximum(mx,1e-6),0)
brown=(h>12)&(h<45)&(s>0.3)&(mx<0.66)
water=np.load('water.npy'); walk=np.load('walk.npy')
solid=~walk&~water
grass=np.zeros(water.shape,bool)
for (x0,y0,x1,y1) in GRASS: grass[y0:y1,x0:x1]=True
rows=[]
for ty in range(N):
    row=''
    for tx in range(N):
        y0,y1=int(ty*T),int((ty+1)*T); x0,x1=int(tx*T),int((tx+1)*T)
        blk=(slice(y0,y1),slice(x0,x1))
        wf=water[blk].mean(); sf=solid[blk].mean(); bf=brown[blk].mean(); gf=grass[blk].mean(); v=mx[blk].mean()
        plateau = x0>=700 and y1<=300
        if wf>0.5: c='~'
        elif sf>0.4: c='#'
        elif plateau: c='.' if (v>0.72 and bf<0.2) else '#'
        elif bf>0.16: c='L'
        elif gf>0.5: c='G'
        else: c='.'
        row+=c
    rows.append(row)
open('tiles_auto.txt','w').write('\n'.join(rows)+'\n')
print('\n'.join(rows))
