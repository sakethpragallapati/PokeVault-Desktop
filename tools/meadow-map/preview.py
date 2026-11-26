import json, os, sys
from PIL import Image
A = os.path.join(os.path.dirname(__file__), '..', '..', 'wwwroot', 'assets', 'meadow')
d = json.load(open(os.path.join(A, 'map.json')))
g = Image.open(os.path.join(A, 'ground.png')).convert('RGBA')
at = Image.open(os.path.join(A, 'objects.png')).convert('RGBA')
for k, x, y in sorted(d['objects'], key=lambda o: o[2]):
    sx, sy, w, h, ax, ay = d['sprites'][k]
    g.alpha_composite(at.crop((sx, sy, sx + w, sy + h)), (int(x - ax), int(y - ay)))
out = sys.argv[1]
g.save(out)
