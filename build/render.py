"""Renders episodes/epNN.json to narrated audio + timing data.

  python3 build/render.py            # all episodes
  python3 build/render.py ep01 ep05  # some

Output: audio/epNN.m4a, audio/epNN-tK-x.m4a (threshold replies), data/episodes.js
Voice clips are cached in tmp/cache by content hash, so re-runs only re-speak changed text.
"""
import array, hashlib, json, math, os, re, subprocess, sys, time, wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "tmp" / "cache"
SR = 22050
VOICES = {  # name, say rate (wpm), ffmpeg filter
    "keeper": ("Zoe (Premium)", 150, "atempo=0.92,highpass=f=70"),
    "book": ("Daniel", 138, "asetrate=22050*0.94,aresample=22050,atempo=1.03,highpass=f=60"),
}
# ENGINE=openai (default) uses OpenAI speech; ENGINE=say uses the macOS voices above.
ENGINE = os.environ.get("ENGINE", "openai")
OPENAI = {  # voice, acting directions
    "keeper": ("marin", "You are the Keeper, host of a late-night podcast about an old book of spirits. "
               "Voice: low, warm, intimate, close to the microphone, as if speaking by candlelight to one listener. "
               "Pace: unhurried and steady, with small pauses before names and at the ends of sentences. "
               "Tone: quietly amused, curious, never theatrical or spooky-voiced, never rushed. "
               "Keep the same voice, pitch and volume throughout. Read the text exactly as written."),
    "book": ("cedar", "You are reading aloud from a seventeenth-century English grimoire. "
             "Voice: deep, dry, grave and formal, like an old clerk reading a legal record. British accent. "
             "Pace: slow and measured, each clause weighed. No warmth, no drama, no whispering. "
             "Keep the same voice, pitch and volume throughout. Read the text exactly as written."),
}
TARGET_RMS = 2600   # per-clip level, so lines generated separately sit at one loudness
GAP = {"keeper": 0.75, "book": 1.05}
SCENE_GAP = 0.9      # extra silence before a segment that changes scene/mood
HEAD, TAIL = 2.5, 3.0

PRON = {  # display spelling -> what the synthesizer should be given
    "Bael": "Bay-el", "Goetia": "Go-eesha", "Goetic": "Go-etic", "Lemegeton": "Lemma-getton",
    "Weyer": "Vyer", "Paimon": "Pie-mon", "Asmoday": "Asmo-day", "Samigina": "Sammy-geena",
    "Leraje": "Lerah-yay", "Eligos": "Elli-goss", "Glasya-Labolas": "Glass-ya Labbo-las",
    "Naberius": "Nah-beerius", "Ronove": "Ronno-vay", "Gaap": "Gahp", "Phenex": "Fennix",
    "Haagenti": "Hah-genty", "Camio": "Cammy-oh", "Cimejes": "Kim-eyes", "Uvall": "Oo-vall",
    "Volac": "Voh-lack", "Haures": "How-res", "Seere": "Seer", "Aim": "Ah-eem", "Ose": "Oh-zay",
    "Amy": "Ah-mee", "Vine": "Vee-nay", "Sitri": "Sit-ree", "Zepar": "Zeh-par", "Marchosias": "Mar-ko-sias", "Vepar": "Veh-par", "Bune": "Boo-nay", "Bifrons": "Bye-frons", "Furcas": "Fur-kass", "Andrealphus": "Andre-alfus", "Decarabia": "Decka-rabia", "Purson": "Pur-son", "Crocell": "Cro-sell", "Pseudomonarchia Daemonum": "Soodo-monarkia Day-monum", "Ars": "Arz",
    "Theurgia": "Thee-urgia", "Almadel": "Alma-dell", "Notoria": "No-toria", "Aeshma": "Ay-eshma",
    "Sloane": "Slone", "Dictionnaire Infernal": "Dictionair Anfernal",
}
PRON_RE = re.compile(r"\b(" + "|".join(re.escape(k) for k in sorted(PRON, key=len, reverse=True)) + r")\b")


def spoken(text):
    return PRON_RE.sub(lambda m: PRON[m.group(1)], text.replace("1,200", "twelve hundred"))


def level(path):
    """Scales a clip to TARGET_RMS (measured on its louder half) without clipping."""
    a = pcm(path)
    if not a:
        return
    win = SR // 10
    e = sorted(math.sqrt(sum(x * x for x in a[i:i + win]) / win) for i in range(0, len(a) - win, win)) or [1]
    loud = e[len(e) // 2:]
    rms = sum(loud) / len(loud) or 1
    g = min(TARGET_RMS / rms, 30000 / max(1, max(abs(x) for x in a)))
    b = array.array("h", (int(x * g) for x in a))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(b.tobytes())


def speak_openai(voice, text):
    name, instr = OPENAI[voice]
    s = spoken(text)
    key = hashlib.sha1(f"openai|{name}|{instr}|{s}".encode()).hexdigest()[:20]
    out = CACHE / f"{key}.wav"
    if out.exists() and out.stat().st_size > 1000:
        return out
    body = json.dumps({"model": "gpt-4o-mini-tts", "voice": name, "input": s, "instructions": instr,
                       "response_format": "wav"}).encode()
    raw = CACHE / f"{key}.raw.wav"
    req = CACHE / f"{key}.json"
    req.write_bytes(body)
    # curl (system certificates); the key goes in via stdin config so it never appears in the process list
    cfg = f'header = "Authorization: Bearer {os.environ["OPENAI_API_KEY"]}"\nheader = "Content-Type: application/json"\n'
    for attempt in range(6):
        r = subprocess.run(["curl", "-sS", "-K", "-", "--max-time", "240", "-o", str(raw), "-w", "%{http_code}",
                            "--data-binary", f"@{req}", "https://api.openai.com/v1/audio/speech"],
                           input=cfg, capture_output=True, text=True)
        code = r.stdout.strip()
        if code == "200" and raw.exists() and raw.stat().st_size > 2000:
            break
        msg = raw.read_text(errors="replace")[:300] if raw.exists() else r.stderr[:300]
        if attempt == 5 or "insufficient_quota" in msg or code in ("400", "401", "403", "404"):
            raise RuntimeError(f"OpenAI speech failed ({code}): {msg}")
        time.sleep(3 * (attempt + 1))
    req.unlink()
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(raw), "-af", "highpass=f=60",
                    "-ar", str(SR), "-ac", "1", "-c:a", "pcm_s16le", str(out)], check=True)
    raw.unlink()
    level(out)
    return out


def speak(voice, text):
    """Returns path of a cached 22.05k mono s16 wav for this line."""
    if ENGINE == "openai":
        return speak_openai(voice, text)
    name, rate, filt = VOICES[voice]
    s = spoken(text)
    key = hashlib.sha1(f"{name}|{rate}|{filt}|{s}".encode()).hexdigest()[:20]
    out = CACHE / f"{key}.wav"
    if out.exists() and out.stat().st_size > 1000:
        return out
    aiff, txt = CACHE / f"{key}.aiff", CACHE / f"{key}.txt"
    txt.write_text(s, encoding="utf-8")
    subprocess.run(["say", "-v", name, "-r", str(rate), "-o", str(aiff), "-f", str(txt)], check=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(aiff), "-af", filt,
                    "-ar", str(SR), "-ac", "1", "-c:a", "pcm_s16le", str(out)], check=True)
    aiff.unlink(); txt.unlink()
    return out


def pcm(path):
    with wave.open(str(path)) as w:
        assert w.getframerate() == SR and w.getnchannels() == 1 and w.getsampwidth() == 2
        a = array.array("h"); a.frombytes(w.readframes(w.getnframes()))
    return a


def silence(sec):
    return array.array("h", bytes(2 * int(sec * SR)))


def encode(samples, out):
    wav = out.with_suffix(".wav")
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(samples.tobytes())
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav),
                    "-af", "loudnorm=I=-18:TP=-2:LRA=9,aresample=44100",
                    "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", str(out)], check=True)
    wav.unlink()
    d = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out)],
                       capture_output=True, text=True, check=True).stdout.strip()
    return round(float(d), 2)


def render(ep):
    eid = ep["id"]
    jobs = []
    for s in ep["segments"]:
        if "threshold" in s:
            th = s["threshold"]
            jobs.append(("keeper", th["q"]))
            jobs += [("keeper", o["reply"]) for o in th["opts"]]
        else:
            jobs.append((s["v"], s["t"]))
    with ThreadPoolExecutor(6) as ex:
        clips = dict(zip(jobs, ex.map(lambda j: speak(*j), jobs)))

    track, segs, words = silence(HEAD), [], 0
    for i, s in enumerate(ep["segments"]):
        if "threshold" in s:
            th = s["threshold"]
            a = pcm(clips[("keeper", th["q"])])
            start = len(track) / SR
            track += a
            end = len(track) / SR
            track += silence(1.0)
            opts = []
            for o in th["opts"]:
                f = f"audio/{th['id']}-{o['key']}.m4a"
                dur = encode(silence(0.3) + pcm(clips[("keeper", o["reply"])]) + silence(0.6), ROOT / f)
                opts.append({"key": o["key"], "label": o["label"], "trait": o.get("trait", "seeker"),
                             "reply": o["reply"], "audio": f, "dur": dur})
                words += 0
            words += len(th["q"].split())
            segs.append({"i": i, "kind": "threshold", "id": th["id"], "v": "keeper", "t": th["q"],
                         "start": round(start, 2), "end": round(end, 2), "opts": opts})
            continue
        if i and ("scene" in s or "mood" in s):
            track += silence(SCENE_GAP)
        a = pcm(clips[(s["v"], s["t"])])
        start = len(track) / SR
        track += a
        end = len(track) / SR
        track += silence(GAP[s["v"]])
        words += len(s["t"].split())
        seg = {"i": i, "kind": "say", "v": s["v"], "t": s["t"], "start": round(start, 2), "end": round(end, 2)}
        for k in ("src", "spirit", "mood", "scene", "term"):
            if k in s:
                seg[k] = s[k]
        segs.append(seg)
    track += silence(TAIL)
    dur = encode(track, ROOT / f"audio/{eid}.m4a")
    out = {k: ep[k] for k in ("id", "num", "title", "subtitle", "blurb", "mood", "scene")}
    out.update(audio=f"audio/{eid}.m4a", duration=dur, words=words, segments=segs, glossary=ep.get("glossary", []))
    print(f"{eid}  {dur/60:5.2f} min  {words} words  {len(segs)} segments", flush=True)
    return out


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    (ROOT / "audio").mkdir(exist_ok=True)
    want = set(sys.argv[1:])
    meta_path = ROOT / "data" / "episodes.json"
    done = {e["id"]: e for e in json.loads(meta_path.read_text())} if meta_path.exists() else {}
    for f in sorted((ROOT / "episodes").glob("ep*.json")):
        ep = json.loads(f.read_text(encoding="utf-8"))
        if want and ep["id"] not in want:
            continue
        done[ep["id"]] = render(ep)
    eps = [done[k] for k in sorted(done)]
    meta_path.write_text(json.dumps(eps, ensure_ascii=False), encoding="utf-8")
    (ROOT / "data" / "episodes.js").write_text("window.EPISODES = " + json.dumps(eps, ensure_ascii=False) + ";\n", encoding="utf-8")
    total = sum(e["duration"] for e in eps)
    replies = sum(max(o["dur"] for o in s["opts"]) for e in eps for s in e["segments"] if s["kind"] == "threshold")
    print(f"TOTAL {len(eps)} episodes  {total/60:.1f} min main  + ~{replies/60:.1f} min replies = {(total+replies)/60:.1f} min")


if __name__ == "__main__":
    main()
