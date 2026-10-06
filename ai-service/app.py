from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import joblib
import os
import pandas as pd
import numpy as np

app = FastAPI(title="LogiTrust AI Service")

backend_origin = os.getenv("BACKEND_ORIGIN", "http://localhost:4000")
allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", f"{backend_origin},http://server:4000,http://127.0.0.1:4000").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

MODEL_PATH = os.path.join(os.path.dirname(__file__), "spoilage_model.joblib")
model = joblib.load(MODEL_PATH) if os.path.exists(MODEL_PATH) else None


class SensorSnapshot(BaseModel):
    temperature: float | None = None
    humidity: float = 50.0
    category: str = "general"
    duration_hrs: float = 10.0
    max_temp_spike: float | None = None
    max_temp: float | None = None
    temp_rel: float | None = None
    spike_rel: float | None = None


@app.get("/health")
def health():
    return {"ok": True, "model_loaded": model is not None}


@app.post("/predict")
def predict(payload: SensorSnapshot):
    if model is None:
        return {"error": "Model not trained yet. Run train_model.py first."}

    # Resolve temperature relative to threshold
    if payload.temp_rel is not None:
        t_rel = payload.temp_rel
    elif payload.temperature is not None and payload.max_temp is not None:
        t_rel = payload.temperature - payload.max_temp
    elif payload.temperature is not None:
        t_rel = payload.temperature - 8.0
    else:
        t_rel = 0.0

    # Resolve max temperature spike relative to threshold
    if payload.spike_rel is not None:
        s_rel = payload.spike_rel
    elif payload.max_temp_spike is not None and payload.max_temp is not None:
        s_rel = payload.max_temp_spike - payload.max_temp
    elif payload.max_temp_spike is not None:
        s_rel = payload.max_temp_spike - 8.0
    else:
        s_rel = max(t_rel, t_rel + 1.0)

    s_rel = max(s_rel, t_rel)
    cat = str(payload.category or "general").strip().lower()
    if cat not in ["dairy", "pharma", "produce", "electronics", "general"]:
        cat = "general"

    df = pd.DataFrame([{
        "temp_rel": float(t_rel),
        "spike_rel": float(s_rel),
        "humidity": float(payload.humidity),
        "duration_hrs": float(payload.duration_hrs),
        "category": cat,
    }])

    prob = model.predict_proba(df)[0][1]
    risk_score = round(float(prob) * 100, 1)

    if risk_score <= 30:
        band = "low"
    elif risk_score <= 60:
        band = "medium"
    else:
        band = "high"

    return {"risk_score": risk_score, "band": band, "category": cat}
