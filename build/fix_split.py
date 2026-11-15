"""For lines whose very short last sentence the speech model keeps dropping: record the last sentence
as its own clip and join it on. Works from tmp/verify.json entries marked ok=False."""
import json, os, re, sys, wave
sys.path.insert(0, os.path.dirname(__file__))
import render, verify_lib as V
from fix import tail_ok

out = json.load(open(render.ROOT / "tmp/verify.json"))
for r in out:
    if r.get("ok") is not False:
        continue
    a = V.norm(render.spoken(r["text"]))
    if tail_ok(a, V.norm(r["heard"])) or a[-1] == V.norm(r["heard"])[-1]:
        r["ok"] = True; continue
    parts = re.split(r"(?<=[.?!])\s+", r["text"].strip())
    n = 2 if len(parts[-1].split()) + len(parts[-2].split()) <= 4 else 1
    head, last = " ".join(parts[:-n]), " ".join(parts[-n:])
    good = False
    for k in range(4):
        hp = render.speak(r["v"], head)
        if tail_ok(V.norm(render.spoken(head)), V.norm(V.transcribe(hp))):
            good = True; break
        if k < 3: hp.unlink()
    lgood = False
    for k in range(4):
        lp = render.speak(r["v"], last)
        lh = V.norm(V.transcribe(lp))
        if lh == V.norm(render.spoken(last)):
            lgood = True; break
        if k < 3: lp.unlink()
    joined = render.pcm(hp) + render.silence(0.45) + render.pcm(lp)
    with wave.open(str(render.CACHE / r["file"]), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(render.SR); w.writeframes(joined.tobytes())
    heard = V.transcribe(render.CACHE / r["file"])
    r.update(heard=heard, ok=tail_ok(a, V.norm(heard)), split=True)
    print(r["ep"], r["i"], "head ok" if good else "HEAD?", "last ok" if lgood else "LAST?", "| last:", last, "| heard end:", heard[-60:])
json.dump(out, open(render.ROOT / "tmp/verify.json", "w"), ensure_ascii=False, indent=1)
