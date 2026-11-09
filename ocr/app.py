"""OCR-Dienst für den GeoGuessr Helper (Tesseract).

POST /ocr    – Body: Bild → erkannter Text, Schrift, Lesarten je Sprachmodell
GET  /health – Status

Wird nur intern vom Backend aufgerufen (kein Port nach außen nötig).
"""
import io
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor

import pytesseract
from fastapi import FastAPI, HTTPException, Request
from PIL import Image, ImageOps

app = FastAPI(title="GeoGuessr Helper OCR")

# Sprachen je Schriftsystem. Jede Sprache wird einzeln gelesen (plus einmal kombiniert): Tesseract
# erkennt Sonderzeichen wie ő, ł, ř, ğ, ș, å nur zuverlässig mit dem passenden Sprachmodell –
# und genau diese Zeichen verraten oft das Land.
SCRIPTS = {
    "Latin": "eng deu fra spa por ita nld pol ces slk hun ron tur hrv slv lav lit est fin swe dan nor isl sqi vie ind msa".split(),
    "Cyrillic": "rus ukr bul srp mkd mon".split(),
    "Greek": ["ell"],
    "Hebrew": ["heb"],
    "Arabic": ["ara"],
    "Thai": ["tha"],
    "Khmer": ["khm"],
    "Lao": ["lao"],
    "Han": ["chi_sim", "chi_tra", "jpn"],
    "Japanese": ["jpn"],
    "Hangul": ["kor"],
    "Korean": ["kor"],
    "Georgian": ["kat"],
    "Armenian": ["hye"],
    "Devanagari": ["hin"],
    "Bengali": ["ben"],
    "Tamil": ["tam"],
    "Sinhala": ["sin"],
}
# Lesarten, die höchstens so viele Prozentpunkte unter der besten liegen, zählen mit
KEEP_WITHIN = 8.0


def load_image(data: bytes) -> Image.Image:
    if not data:
        raise HTTPException(400, "Leeres Bild")
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)
        return img.convert("RGB")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Kein lesbares Bild: {exc}") from exc


@app.get("/health")
def health():
    return {"ok": True, "tesseract": str(pytesseract.get_tesseract_version())}


def tiled(img: Image.Image, n: int = 3) -> Image.Image:
    """Bild n×n kacheln: die Schrift-Erkennung (OSD) braucht viel Text, Schilder haben wenig."""
    w, h = img.size
    out = Image.new("L", (w * n, h * n), 255)
    for i in range(n):
        for j in range(n):
            out.paste(img, (i * w, j * h))
    return out


def detect_script(img: Image.Image) -> tuple[str | None, float]:
    for candidate in (img, tiled(img)):
        try:
            osd = pytesseract.image_to_osd(candidate, output_type=pytesseract.Output.DICT, config="--psm 0")
            if osd.get("script") in SCRIPTS:
                return osd["script"], float(osd.get("script_conf", 0))
        except pytesseract.TesseractError:
            pass  # zu wenig Text → nächster Versuch
    return None, 0.0


def read(img: Image.Image, lang: str, psm: int) -> dict:
    """Eine OCR-Runde; Bewertung = mittlere Wort-Sicherheit."""
    data = pytesseract.image_to_data(img.copy(), lang=lang, config=f"--psm {psm}", output_type=pytesseract.Output.DICT)
    words = [(t.strip(), float(c)) for t, c in zip(data["text"], data["conf"]) if t.strip() and float(c) >= 0]
    text = " ".join(t for t, _ in words)
    # Thai/Khmer/Lao kennen keine Leerzeichen zwischen Wörtern – Tesseract setzt welche zwischen die Zeichen
    text = re.sub(r"(?<=[฀-໿ក-៿]) (?=[฀-໿ក-៿])", "", text)
    conf = sum(c for _, c in words) / len(words) if words else 0.0
    return {"lang": lang, "confidence": round(conf, 1), "text": text}


@app.post("/ocr")
async def ocr(request: Request):
    start = time.time()
    img = load_image(await request.body())
    # Kleine Ausschnitte vergrößern – Tesseract mag Schrift ab ~30 px Höhe
    w, h = img.size
    if min(w, h) < 700:
        factor = min(3.0, 700 / max(min(w, h), 1))
        img = img.resize((int(w * factor), int(h * factor)), Image.LANCZOS)
    gray = ImageOps.autocontrast(img.convert("L"))

    script, script_conf = detect_script(gray)
    langs = SCRIPTS.get(script) or SCRIPTS["Latin"]
    jobs = [(lang, 6) for lang in langs]
    if len(langs) > 1:
        jobs.append(("+".join(langs), 11))  # kombiniert, verstreuter Text
    with ThreadPoolExecutor(max_workers=6) as pool:
        passes = list(pool.map(lambda j: read(gray, *j), jobs))
    passes = [p for p in passes if p["text"]]
    passes.sort(key=lambda p: p["confidence"], reverse=True)
    best = passes[0]["confidence"] if passes else 0.0
    # Alle guten Lesarten behalten (unterschiedliche Texte), damit Sonderzeichen nicht verloren gehen
    variants, seen = [], set()
    for p in passes:
        if p["confidence"] >= best - KEEP_WITHIN and p["confidence"] >= 50 and p["text"] not in seen:
            seen.add(p["text"])
            variants.append(p)
    return {
        "script": script,
        "script_conf": round(script_conf, 2),
        "text": variants[0]["text"] if variants else "",
        "variants": variants[:8],
        "ms": int((time.time() - start) * 1000),
    }
