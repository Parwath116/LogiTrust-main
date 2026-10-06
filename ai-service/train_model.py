"""
Generates a synthetic cold-chain dataset (temperature relative to threshold,
spike relative to threshold, humidity, duration, and category -> spoilage risk)
and trains a scikit-learn Pipeline with GradientBoostingClassifier.

NOTE: This dataset is SYNTHETICALLY GENERATED for development and testing
benchmarks based on cold-chain degradation models. It models differential
perishability across categories (pharma, dairy, produce, electronics, general).
"""
import numpy as np
import pandas as pd
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, precision_score, recall_score
import joblib

np.random.seed(42)
N = 15000

# Synthetic category distribution
categories = ["dairy", "pharma", "produce", "electronics", "general"]
cat = np.random.choice(categories, N, p=[0.25, 0.25, 0.20, 0.15, 0.15])

# temp_rel: relative difference to shipment maxTemp (degrees Celsius)
# Negative = safely below maxTemp; Positive = temperature breach
temp_rel = np.random.normal(-2.0, 3.5, N)

# spike_rel: highest temperature spike relative to shipment maxTemp (>= temp_rel)
spike_rel = temp_rel + np.abs(np.random.normal(1.5, 2.0, N))

# humidity: percentage (10% to 98%)
humidity = np.clip(np.random.normal(55, 15, N), 10, 98)

# duration_hrs: transit duration in hours (0.5 to 72 hrs)
duration_hrs = np.clip(np.random.exponential(14, N) + 0.5, 0.5, 72.0)

# Realistic multi-variable risk function
risk_logit = np.zeros(N)
for c in categories:
    mask = (cat == c)
    if c == "pharma":
        # Pharma is highly sensitive to any temperature breach
        risk_logit[mask] = (
            0.70 * np.maximum(0, temp_rel[mask])
            + 0.50 * np.maximum(0, spike_rel[mask])
            + 0.02 * (humidity[mask] - 50)
            + 0.04 * duration_hrs[mask]
            - 1.6
        )
    elif c == "dairy":
        # Dairy degrades steadily with warmth and duration
        risk_logit[mask] = (
            0.50 * np.maximum(0, temp_rel[mask])
            + 0.35 * np.maximum(0, spike_rel[mask])
            + 0.02 * (humidity[mask] - 55)
            + 0.035 * duration_hrs[mask]
            - 1.3
        )
    elif c == "produce":
        # Fresh produce is sensitive to temperature, humidity swings, and time
        risk_logit[mask] = (
            0.35 * np.maximum(0, temp_rel[mask])
            + 0.25 * np.maximum(0, spike_rel[mask])
            + 0.03 * (humidity[mask] - 60)
            + 0.03 * duration_hrs[mask]
            - 1.1
        )
    elif c == "electronics":
        # Electronics are primarily sensitive to high humidity condensation
        risk_logit[mask] = (
            0.12 * np.maximum(0, temp_rel[mask])
            + 0.10 * np.maximum(0, spike_rel[mask])
            + 0.08 * (humidity[mask] - 70)
            + 0.015 * duration_hrs[mask]
            - 1.9
        )
    else:  # general cargo
        risk_logit[mask] = (
            0.38 * np.maximum(0, temp_rel[mask])
            + 0.25 * np.maximum(0, spike_rel[mask])
            + 0.025 * (humidity[mask] - 55)
            + 0.025 * duration_hrs[mask]
            - 1.3
        )

# Add stochastic ambient variance
risk_logit += np.random.normal(0, 0.4, N)
prob_spoiled = 1.0 / (1.0 + np.exp(-risk_logit))
y = (prob_spoiled > 0.5).astype(int)

# Create DataFrame with raw features
df = pd.DataFrame({
    "temp_rel": temp_rel,
    "spike_rel": spike_rel,
    "humidity": humidity,
    "duration_hrs": duration_hrs,
    "category": cat
})

numeric_features = ["temp_rel", "spike_rel", "humidity", "duration_hrs"]
categorical_features = ["category"]

preprocessor = ColumnTransformer(
    transformers=[
        ("num", StandardScaler(), numeric_features),
        ("cat", OneHotEncoder(categories=[categories], handle_unknown="ignore"), categorical_features),
    ]
)

pipeline = Pipeline(
    steps=[
        ("preprocessor", preprocessor),
        ("classifier", GradientBoostingClassifier(n_estimators=150, max_depth=3, learning_rate=0.1, random_state=42)),
    ]
)

X_train, X_test, y_train, y_test = train_test_split(df, y, test_size=0.2, random_state=42)

print("Training GradientBoostingClassifier pipeline on synthetic dataset...")
pipeline.fit(X_train, y_train)

y_pred = pipeline.predict(X_test)
precision = precision_score(y_test, y_pred)
recall = recall_score(y_test, y_pred)

print("\n=== Model Evaluation Metrics ===")
print(f"Precision: {precision:.4f}")
print(f"Recall:    {recall:.4f}")
print("\nClassification Report:")
print(classification_report(y_test, y_pred, target_names=["Safe", "Spoiled"]))

joblib.dump(pipeline, "spoilage_model.joblib")
print("Saved retrained pipeline model to spoilage_model.joblib")
