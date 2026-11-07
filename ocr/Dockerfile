# Bilderkennung für den GeoGuessr Helper: CLIP (Bild-Ähnlichkeit) + Tesseract (OCR)
FROM python:3.11-slim

# Tesseract mit Sprachen/Schriften, die in GeoGuessr häufig vorkommen
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-osd \
      tesseract-ocr-eng tesseract-ocr-deu tesseract-ocr-fra tesseract-ocr-spa tesseract-ocr-por tesseract-ocr-ita \
      tesseract-ocr-nld tesseract-ocr-pol tesseract-ocr-ces tesseract-ocr-slk tesseract-ocr-hun tesseract-ocr-ron \
      tesseract-ocr-tur tesseract-ocr-hrv tesseract-ocr-slv tesseract-ocr-lav tesseract-ocr-lit tesseract-ocr-est \
      tesseract-ocr-fin tesseract-ocr-swe tesseract-ocr-dan tesseract-ocr-nor tesseract-ocr-isl tesseract-ocr-cat \
      tesseract-ocr-sqi tesseract-ocr-vie tesseract-ocr-ind tesseract-ocr-msa \
      tesseract-ocr-rus tesseract-ocr-ukr tesseract-ocr-bul tesseract-ocr-srp tesseract-ocr-mkd tesseract-ocr-mon \
      tesseract-ocr-ell tesseract-ocr-heb tesseract-ocr-ara tesseract-ocr-tha tesseract-ocr-khm tesseract-ocr-lao \
      tesseract-ocr-jpn tesseract-ocr-kor tesseract-ocr-chi-sim tesseract-ocr-chi-tra \
      tesseract-ocr-kat tesseract-ocr-hye tesseract-ocr-hin tesseract-ocr-ben tesseract-ocr-sin tesseract-ocr-tam \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
# PyTorch nur für CPU (deutlich kleiner als die CUDA-Variante)
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt

# CLIP-Modell beim Bauen herunterladen, damit der Container offline startet
ENV HF_HOME=/models \
    CLIP_MODEL=ViT-B-32 \
    CLIP_PRETRAINED=laion2b_s34b_b79k
RUN python -c "import open_clip, os; open_clip.create_model_and_transforms(os.environ['CLIP_MODEL'], pretrained=os.environ['CLIP_PRETRAINED'])"

COPY app.py .
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
