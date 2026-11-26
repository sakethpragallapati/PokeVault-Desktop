import sys
from PIL import Image, ImageDraw
T=1254/32
c0,r0,c1,r1,sc=map(int,sys.argv[1:6]); out=sys.argv[6]
im=Image.open('map.webp').convert('RGB')
x0,y0,x1,y1=int(c0*T),int(r0*T),int(c1*T),int(r1*T)
c=im.crop((x0,y0,x1,y1)).resize(((x1-x0)*sc,(y1-y0)*sc),Image.NEAREST)
d=ImageDraw.Draw(c)
for k in range(c0,c1+1):
    X=int((k*T-x0)*sc); d.line([(X,0),(X,c.height)],fill=(0,0,0)); d.text((X+3,3),str(k),fill=(255,255,0))
for k in range(r0,r1+1):
    Y=int((k*T-y0)*sc); d.line([(0,Y),(c.width,Y)],fill=(0,0,0)); d.text((3,Y+3),str(k),fill=(255,255,0))
c.save(out)
