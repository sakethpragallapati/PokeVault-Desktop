import sys
from PIL import Image, ImageDraw
N=32; T=1254/N
src=sys.argv[1] if len(sys.argv)>1 else 'tiles_auto.txt'
rows=[l.rstrip('\n') for l in open(src) if l.strip()]
im=Image.open('map.webp').convert('RGB')
COL={'#':(255,0,0),'~':(0,90,255),'L':(255,140,0),'v':(255,140,0),'<':(255,140,0),'>':(255,140,0),'G':(0,255,120),'S':(255,255,0),'.':None}
big=im.resize((2508,2508),Image.NEAREST)
ov=Image.new('RGBA',big.size,(0,0,0,0)); d=ImageDraw.Draw(ov)
for ty,row in enumerate(rows):
    for tx,c in enumerate(row):
        x0,y0=int(tx*T*2),int(ty*T*2); x1,y1=int((tx+1)*T*2),int((ty+1)*T*2)
        col=COL.get(c)
        if col: d.rectangle((x0,y0,x1,y1),fill=col+(70,))
        d.rectangle((x0,y0,x1,y1),outline=(0,0,0,110))
        d.text((x0+3,y0+2),c,fill=(255,255,255,255))
for k in range(N):
    d.text((int(k*T*2)+30,2),str(k),fill=(255,255,0,255)); d.text((2,int(k*T*2)+30),str(k),fill=(255,255,0,255))
big=Image.alpha_composite(big.convert('RGBA'),ov).convert('RGB')
for name,(qx,qy) in {'t1':(0,0),'t2':(1,0),'t3':(0,1),'t4':(1,1)}.items():
    big.crop((qx*1254,qy*1254,qx*1254+1254,qy*1254+1254)).save(name+'.png')
