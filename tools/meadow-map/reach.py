from collections import deque
rows=[l.rstrip('\n') for l in open('tiles.txt') if l.strip()]
N=32
W=lambda x,y: 0<=x<N and 0<=y<N and rows[y][x] in '.GS'
start=(16,14)
assert W(*start), rows[14][16]
seen={start}; q=deque([start])
while q:
    x,y=q.popleft()
    for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)):
        nx,ny=x+dx,y+dy
        if W(nx,ny) and (nx,ny) not in seen: seen.add((nx,ny)); q.append((nx,ny))
        elif dy==1 and 0<=ny<N and rows[ny][nx]=='v' and W(nx,ny+1) and (nx,ny+1) not in seen:
            seen.add((nx,ny+1)); q.append((nx,ny+1))
walk=[(x,y) for y in range(N) for x in range(N) if W(x,y)]
un=[p for p in walk if p not in seen]
print('walkable',len(walk),'reachable',len(seen),'unreachable',len(un))
# group unreachable
left=set(un); groups=[]
while left:
    s=left.pop(); g=[s]; st=[s]
    while st:
        x,y=st.pop()
        for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)):
            n=(x+dx,y+dy)
            if n in left: left.remove(n); g.append(n); st.append(n)
    groups.append(sorted(g))
for g in groups: print(len(g), g[:12])
