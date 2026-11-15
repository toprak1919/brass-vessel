"""Continuity check: episodes vs CONTRACT plan and canon. usage: python3 build/check.py"""
import json, re, sys
from pathlib import Path
R = Path(__file__).resolve().parent.parent
PLAN = {1:[1],2:[2,3,4],3:[13,29],4:[17,21,22,25,27,33,50],5:[9,20,32,45,51,61,68],6:[5,8,10,11,24,31,36,48,53,55,58,60],
7:[6,12,14,15,16,19,34,40,44,47,56,63],8:[30,35,37,41,42,49,59,62,64,65,67,69],9:[7,26,28,46,54],10:[18,23,38,39],11:[52,57,66,71],12:[43,70,72]}
OK = {"crypt","library","court","storm","sea","fire","void","dawn"}
canon = {s["n"]: s for s in json.loads((R/"data/canon.json").read_text())["spirits"]}
bad = 0; total = 0
def err(e, m):
    global bad; bad += 1; print(f"  !! {e}: {m}")
for n in range(1, 13):
    f = R/f"episodes/ep{n:02d}.json"
    if not f.exists(): print(f"ep{n:02d} MISSING"); bad += 1; continue
    try: ep = json.loads(f.read_text(encoding="utf-8"))
    except Exception as x: err(f.name, f"bad json {x}"); continue
    e = ep.get("id"); words = 0; cues = []; ths = []; gl = {g["id"] for g in ep.get("glossary", [])}
    for k in ("id","num","title","subtitle","blurb","mood","scene","segments"):
        if k not in ep: err(e, f"missing {k}")
    if ep.get("mood") not in OK or ep.get("scene") not in OK: err(e, "bad top mood/scene")
    for i, s in enumerate(ep["segments"]):
        if "threshold" in s:
            t = s["threshold"]; ths.append(t["id"]); words += len(t["q"].split())
            if not 2 <= len(t["opts"]) <= 3: err(e, f"{t['id']} opts")
            texts = [t["q"]] + [o["reply"] for o in t["opts"]]
            for o in t["opts"]:
                if o.get("trait") not in ("scholar","seeker","skeptic","poet"): err(e, f"{t['id']} trait {o.get('trait')}")
        else:
            if s.get("v") not in ("keeper","book"): err(e, f"seg {i} voice")
            words += len(s["t"].split()); texts = [s["t"]]
            if "spirit" in s: cues.append(s["spirit"])
            if "term" in s and s["term"] not in gl: err(e, f"seg {i} term {s['term']} not in glossary")
            for k in ("mood","scene"):
                if k in s and s[k] not in OK: err(e, f"seg {i} {k}={s[k]}")
            if "spirit" in s:
                c = canon[s["spirit"]]
                if c["name"].lower() not in s["t"].lower(): err(e, f"seg {i} cue {c['name']} but name not spoken")
            if len(s["t"].split()) > 125: err(e, f"seg {i} long ({len(s['t'].split())}w)")
        for x in texts:
            m = re.findall(r"[()\[\]/&\"“”*_#<>]", x)
            if m: err(e, f"seg {i} chars {set(m)}")
            if not ("v" in s and s["v"] == "book") and re.search(r"\d", x): err(e, f"seg {i} digits: {re.findall(r'[^ ]*\d[^ ]*', x)}")
    if sorted(cues) != PLAN[n]: err(e, f"spirits {sorted(cues)} != plan {PLAN[n]}")
    if len(ths) != 2: err(e, f"{len(ths)} thresholds")
    total += words
    print(f"{e}: {words} words, {len(ep['segments'])} segs, {len(cues)} spirits, last scene {[s.get('scene') for s in ep['segments'] if 'scene' in s][-1:] }")
print(f"TOTAL words {total}; problems {bad}")
sys.exit(1 if bad else 0)
