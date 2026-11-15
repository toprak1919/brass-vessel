import os, re, subprocess

def norm(s):
    return re.sub(r"[^a-z0-9 ]", " ", s.lower().replace("-", " ")).split()

def transcribe(path):
    cfg = f'header = "Authorization: Bearer {os.environ["OPENAI_API_KEY"]}"\n'
    for _ in range(4):
        r = subprocess.run(["curl", "-sS", "-K", "-", "--max-time", "180", "https://api.openai.com/v1/audio/transcriptions",
                            "-F", "model=gpt-4o-mini-transcribe", "-F", "response_format=text", "-F", "language=en",
                            "-F", f"file=@{path}"], input=cfg, capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip() and '"error"' not in r.stdout[:40]:
            return r.stdout.strip()
    return "!!FAILED " + r.stdout[:200]

