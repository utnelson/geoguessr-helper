"""CLIP-Dienst für den GeoGuessr Helper (Bild-Ähnlichkeitssuche).

POST /embed  – Body: Bild → CLIP-Vektor (normiert, 512 Werte)
GET  /health – Status + Modellname

Optional: braucht ~0,8 GB RAM. Wird nur intern vom Backend aufgerufen.
"""
import io
import os

import open_clip
import torch
from fastapi import FastAPI, HTTPException, Request
from PIL import Image, ImageOps

MODEL = os.environ.get("CLIP_MODEL", "ViT-B-32")
PRETRAINED = os.environ.get("CLIP_PRETRAINED", "laion2b_s34b_b79k")
MODEL_NAME = f"{MODEL}/{PRETRAINED}"
torch.set_num_threads(int(os.environ.get("TORCH_THREADS", "2")))

model, _, preprocess = open_clip.create_model_and_transforms(MODEL, pretrained=PRETRAINED)
model.eval()

app = FastAPI(title="GeoGuessr Helper CLIP")


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
    return {"ok": True, "model": MODEL_NAME, "dim": model.visual.output_dim}


@app.post("/embed")
async def embed(request: Request):
    img = load_image(await request.body())
    with torch.no_grad():
        vec = model.encode_image(preprocess(img).unsqueeze(0))
        vec = vec / vec.norm(dim=-1, keepdim=True)
    return {"model": MODEL_NAME, "vector": [round(float(x), 6) for x in vec[0]]}
