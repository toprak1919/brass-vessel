"""Re-records clips whose ending (or opening) was dropped by the speech model, using tmp/verify.json.
Each new take is transcribed; the first take with the right ending is kept, otherwise the longest."""
import difflib, json, os, shutil, sys
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(__file__))
import render, verify_lib as V

def tail_ok(a, b):
    if a[-3:] == b[-3:]:
        return True
    return difflib.SequenceMatcher(None, "".join(a[-4:]), "".join(b[-4:])).ratio() >= 0.72

def fix(r):
    p = render.CACHE / r["file"]
    a = V.norm(render.spoken(r["text"]))
    best = (len(render.pcm(p)), p.read_bytes(), r["heard"])
    for n in range(5):
        p.unlink()
        render.speak(r["v"], r["text"])
        heard = V.transcribe(p)
        size = len(render.pcm(p))
        if tail_ok(a, V.norm(heard)):
            r.update(heard=heard, fixed=n + 1, ok=True)
            return r
        if size > best[0]:
            best = (size, p.read_bytes(), heard)
    p.write_bytes(best[1])
    r.update(heard=best[2], fixed=5, ok=False)
    return r

if __name__ == "__main__":
    out = json.load(open(render.ROOT / "tmp/verify.json"))
    todo = [r for r in out if r["heard"].startswith("!!") or not tail_ok(V.norm(render.spoken(r["text"])), V.norm(r["heard"]))]
    print("re-recording", len(todo), "of", len(out))
    with ThreadPoolExecutor(6) as ex:
        done = list(ex.map(fix, todo))
    json.dump(out, open(render.ROOT / "tmp/verify.json", "w"), ensure_ascii=False, indent=1)
    print("fixed", sum(r["ok"] for r in done), "still doubtful", sum(not r["ok"] for r in done))
    for r in done:
        if not r["ok"]:
            print(f"\n{r['ep']} #{r['i']}\n  WANT …{r['text'][-90:]}\n  HEARD …{r['heard'][-90:]}")
