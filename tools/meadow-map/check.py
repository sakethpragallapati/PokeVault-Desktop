# Which tiles can be reached on foot from the spawn point (GBA rules: 4 directions, ledges one way down).
import sys; sys.path.insert(0, '.')
from layout import ROWS, OBJECTS, SPAWN
from collections import deque
FOOT = {'stump': (4, 4), 'boulders': (2, 1), 'log': (2, 1), 'roundtree': (1, 1)}
WALK = set('.,:GPSBo')
N = 32
def solid_grid():
    g = [[c not in WALK and c != 'v' for c in r] for r in ROWS]
    for k, x, y in OBJECTS:
        w, h = FOOT.get(k, (1, 1))
        for j in range(h):
            for i in range(w): g[y + j][x + i] = True
    return g
if __name__ == '__main__':
    for i, r in enumerate(ROWS): assert len(r) == N, (i, len(r))
    solid = solid_grid()
    seen = {SPAWN}; q = deque([SPAWN])
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < N and 0 <= ny < N): continue
            c = ROWS[ny][nx]
            if c == 'v':
                if dy == 1 and ny + 1 < N and not solid[ny + 1][nx] and ROWS[ny + 1][nx] != 'v': nx, ny = nx, ny + 1
                else: continue
            elif solid[ny][nx]: continue
            if (nx, ny) not in seen: seen.add((nx, ny)); q.append((nx, ny))
    out = []
    for y in range(N):
        row = ''
        for x in range(N):
            c = ROWS[y][x]
            if (x, y) in seen: row += c
            elif not solid[y][x] and c != 'v': row += '!'   # walkable but unreachable
            else: row += ' ' if c in 'T' else c.lower() if c.isalpha() else c
        out.append(row)
    print('\n'.join(out))
    print('unreachable walkable tiles:', sum(r.count('!') for r in out))
