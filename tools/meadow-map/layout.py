# The Meadow's 32x32 tile layout, laid out after the map picture (one tile ~ one 39 px square of it).
#  .  grass        ,  flowers      :  sand path     G  tall grass     T  forest (trees)
#  ~  water        W  waterfall    R  rock cliff    C  cliff face     P  plateau floor
#  S  stairs       H  cave         B  bridge        o  stepping stones
#  v  ledge (hop down, one way)    K  low earth wall
ROWS = [
    "RRRRRTTTTTTTTTTTTTTCPPPPPPPPPPPP",  # 0
    "RRWWRTTTTTTTTTTTTTTCPPPPPPPPPPPP",  # 1
    "RRWWRTTTTTTTTTTTTTTCCCHHCCSSCCCC",  # 2
    "RRWWRTTTTTTTTTTTTTTCPPPPPPPPPPPP",  # 3
    "RRWWRTTTTTTTTTTTTTTCCCCCCCSSCCCC",  # 4
    "RR~~~~RTTTTTTTTTTTTCCCCCCCSSCCCC",  # 5
    "RR~~~~...,,..GGGGG.CCCCCCCSSCCCC",  # 6
    "TTT~~~..::...GGGGGG...........TT",  # 7
    "TTTT~~...::..GGGGGGGG...::..TTTT",  # 8
    "TTTTT~.GGGG::.vvGGGGGGK.::..TTTT",  # 9
    "~~~~~~.GGGG.::.K.GGGG.K.::..TTTT",  # 10
    "~~~~~~.GGGG..::K.GGG.,K.::..TTTT",  # 11
    "TT~~~~..GGG...:K......K.::..TTTT",  # 12
    "TTTT~~~~..GG....vvvvvv..::.TTTTT",  # 13
    "TTTTTT~~~.....:::::.......TTTTTT",  # 14
    "TTTTTT~~~.....:::::.......TTTTTT",  # 15
    "TTTTT..~~~~~~~~..............TTT",  # 16
    "TTTT.GGG~~~~~~~BB~~,,,,,,.TTTTTT",  # 17
    "TTTT.GGGG.~~~~~BB~~~~,,,,.TTTTTT",  # 18
    "TTTT.GGGG..XXXXoG.~~~~.GG.TTTTTT",  # 19
    "TTT........XXXXoG.G~~~~...TTTTTT",  # 20
    "TTT....K...XXXXoG.G.~~~~~~~TTTTT",  # 21
    "TTTTTT.K...XXXXoG..GG.~~~~~~TTTT",  # 22
    "TTTT....K..,,,.oGG..GG.~~~~~~TTT",  # 23
    "TTTTGG...K....GoGGG......~~~TTTT",  # 24
    "T...G::::.K...GGGGGTTTTT...TTTTT",  # 25
    "TT...::::.K...GGGGGTTTTTT..TTTTT",  # 26
    "TT...GG::.K...GGGG.TTTTTTTTTTTTT",  # 27
    "TTT..GG...K.,......TTTTTTTTTTTTT",  # 28
    "TTTTTT...K...::::..TTTTTTTTTTTTT",  # 29
    "TTTTTT...GTTTG:::..TTTTTTTTTTTTT",  # 30
    "TTTTTT...GTTTG:::..TTTTTTTTTTTTT",  # 31
]
# Objects on top of the ground: (kind, col, row). Their footprint tiles are solid.
OBJECTS = [
    ('rock', 11, 6), ('mushroom', 12, 6), ('mushroom', 20, 7), ('bush', 23, 7), ('boulders', 28, 7),
    ('fence_h', 7, 8), ('fence_h', 8, 8), ('roundtree', 23, 8), ('mushroom', 11, 10), ('mushroom', 16, 10),
    ('mushroom', 12, 11), ('rock', 20, 11), ('mushroom', 23, 11), ('log', 17, 12), ('sign', 20, 12),
    ('fence_h', 13, 13), ('fence_h', 14, 13), ('fence_h', 10, 14), ('fence_h', 11, 14), ('rock', 12, 14),
    ('rocks_small', 31, 3), ('stump', 11, 19),
    ('fence_v', 17, 19), ('fence_v', 17, 20), ('fence_v', 17, 21), ('fence_h', 17, 22), ('fence_h', 18, 22),
    ('fence_h', 18, 23), ('fence_h', 19, 23), ('rock', 5, 23), ('post', 1, 25), ('rock', 2, 26),
    ('post', 3, 28), ('fence_d', 7, 28), ('fence_d', 8, 28), ('smallpine', 11, 27),
]
SPAWN = (16, 15)
