"""
Generates a synthetic cold-chain dataset (temperature/humidity/duration -> spoiled)
and trains a GradientBoostingClassifier, matching the methodology described in
the LogiTrust Phase 1 report (Section 4.4).
"""
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
import joblib

np.random.seed(42)
N = 10000

category = np.random.choice(["dairy", "pharma", "produce", "electronics"], N)
avg_temp = np.random.normal(6, 4, N)
max_temp_spike = avg_temp + np.abs(np.random.normal(3, 2, N))
humidity = np.clip(np.random.normal(60, 15, N), 10, 100)
duration_hrs = np.abs(np.random.normal(20, 10, N))

# Spoilage probability rises with temperature spike, humidity and duration
risk_logit = (
    0.35 * (max_temp_spike - 8)
    + 0.02 * (humidity - 60)
    + 0.03 * (duration_hrs - 20)
    + np.random.normal(0, 1.5, N)
)
prob_spoiled = 1 / (1 + np.exp(-risk_logit / 3))
y = (prob_spoiled > np.random.uniform(0.4, 0.6, N)).astype(int)

X = np.column_stack((avg_temp, max_temp_spike, humidity, duration_hrs))
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

model = GradientBoostingClassifier(n_estimators=150, max_depth=3, learning_rate=0.1, random_state=42)
model.fit(X_train, y_train)

print(classification_report(y_test, model.predict(X_test)))

joblib.dump(model, "spoilage_model.joblib")
print("Saved model to spoilage_model.joblib")
