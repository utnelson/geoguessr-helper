# CLIP für den GeoGuessr Helper: Bild-Ähnlichkeitssuche (optional, ~0,9 GB RAM, Image ~0,9 GB)
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
# PyTorch nur für CPU (deutlich kleiner als die CUDA-Variante)
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu  && pip install --no-cache-dir -r requirements.txt

# CLIP-Modell beim Bauen herunterladen, damit der Container offline startet
ENV HF_HOME=/models     CLIP_MODEL=ViT-B-32     CLIP_PRETRAINED=laion2b_s34b_b79k
RUN python -c "import open_clip, os; open_clip.create_model_and_transforms(os.environ['CLIP_MODEL'], pretrained=os.environ['CLIP_PRETRAINED'])"

COPY app.py .
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
