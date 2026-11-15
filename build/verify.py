"""Transcribes every rendered clip and compares it with the script, to catch dropped or invented words.
  python3 build/verify.py     -> tmp/verify.json, prints the worst matches"""
import difflib, glob, hashlib, json, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(__file__))
import render

def key(voice, text):
    name, instr = render.OPENAI[voice]
    return hashlib.sha1(f"openai|{name}|{instr}|{render.spoken(text)}".encode()).hexdigest()[:20]

from verify_lib import norm, transcribe

jobs = []
for f in sorted(glob.glob(str(render.ROOT / "episodes/ep*.json"))):
    ep = json.load(open(f))
    for i, s in enumerate(ep["segments"]):
        if "threshold" in s:
            th = s["threshold"]
            jobs.append((ep["id"], f"{i}q", "keeper", th["q"]))
            jobs += [(ep["id"], f"{i}{o['key']}", "keeper", o["reply"]) for o in th["opts"]]
        else:
            jobs.append((ep["id"], str(i), s["v"], s["t"]))

def run(j):
    eid, i, v, t = j
    p = render.CACHE / f"{key(v, t)}.wav"
    heard = transcribe(p)
    a, b = norm(render.spoken(t)), norm(heard)
    return {"ep": eid, "i": i, "v": v, "ratio": round(difflib.SequenceMatcher(None, a, b).ratio(), 3),
            "want": len(a), "got": len(b), "text": t, "heard": heard, "file": p.name}

with ThreadPoolExecutor(8) as ex:
    out = sorted(ex.map(run, jobs), key=lambda r: r["ratio"])
json.dump(out, open(render.ROOT / "tmp/verify.json", "w"), ensure_ascii=False, indent=1)
print(len(out), "clips; below 0.9:", sum(r["ratio"] < 0.9 for r in out), " below 0.8:", sum(r["ratio"] < 0.8 for r in out))
for r in out[:14]:
    print(f"\n{r['ep']} #{r['i']} {r['v']} ratio {r['ratio']} words {r['want']}->{r['got']}\n  WANT: {r['text'][:230]}\n  HEARD: {r['heard'][:230]}")
