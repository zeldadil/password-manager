import os

brief = "PROJECT_BRIEF.md"
if not os.path.exists(brief):
    raise SystemExit(0)

with open(brief, "rb") as f:
    data = f.read()

idx = data.find(b"TELEGRAM_BOT_TOKEN=")
if idx >= 0:
    chunk = data[idx:idx+55]
    print("bytes:", chunk.hex())
    print("repr:", repr(chunk))
    eq_idx = data.find(b"=", idx)
    print("around =: ", data[eq_idx:eq_idx+20].hex(), repr(data[eq_idx:eq_idx+20]))
else:
    print("TELEGRAM_BOT_TOKEN= not found")
