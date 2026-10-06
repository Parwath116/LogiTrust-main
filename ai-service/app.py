from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import joblib
import os
import numpy as np

app = FastAPI(title="LogiTrust AI Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_PATH = os.path.join(os.path.dirname(__file__), "spoilage_model.joblib")
model = joblib.load(MODEL_PATH) if os.path.exists(MODEL_PATH) else None


class SensorSnapshot(BaseModel):
    temperature: float
    humidity: float
    category: str = "general"
    duration_hrs: float = 10.0
    max_temp_spike: float | None = None


@app.get("/health")
def health():
    return {"ok": True, "model_loaded": model is not None}


@app.post("/predict")
def predict(payload: SensorSnapshot):
    if model is None:
        return {"error": "Model not trained yet. Run train_model.py first."}

    max_spike = payload.max_temp_spike or payload.temperature + 1.5
    features = np.array([[payload.temperature, max_spike, payload.humidity, payload.duration_hrs]])
    prob = model.predict_proba(features)[0][1]
    risk_score = round(float(prob) * 100, 1)

    if risk_score <= 30:
        band = "low"
    elif risk_score <= 60:
        band = "medium"
    else:
        band = "high"

    return {"risk_score": risk_score, "band": band}
