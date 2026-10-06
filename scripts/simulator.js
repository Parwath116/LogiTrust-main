#!/usr/bin/env node

/**
 * LogiTrust Sensor Telemetry Route Simulator
 * Generates an interpolated route between origin and destination coordinates,
 * adds small noise, signs payloads with the shared secret, and publishes via MQTT.
 *
 * Usage:
 *   node scripts/simulator.js [--shipment SHP-123456] [--origin Mumbai] [--dest Pune] [--cadence 3] [--steps 15] [--breach]
 */

import mqtt from "../server/node_modules/mqtt/dist/index.js";
import crypto from "crypto";

const CITY_COORDS = {
  "Bengaluru": [12.9716, 77.5946],
  "Bangalore": [12.9716, 77.5946],
  "Mumbai": [19.0760, 72.8777],
  "Delhi": [28.7041, 77.1025],
  "New Delhi": [28.7041, 77.1025],
  "Hyderabad": [17.3850, 78.4867],
  "Chennai": [13.0827, 80.2707],
  "Kolkata": [22.5726, 88.3639],
  "Pune": [18.5204, 73.8567],
};

// Parse command line arguments
const args = process.argv.slice(2);
function getArg(flag, defaultValue) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultValue;
}

const shipmentId = getArg("--shipment", process.env.SIM_SHIPMENT || "SHP-SIMULATED-01");
const originCity = getArg("--origin", "Mumbai");
const destCity = getArg("--dest", "Pune");
const cadenceSec = parseInt(getArg("--cadence", "3"), 10);
const totalSteps = parseInt(getArg("--steps", "15"), 10);
const isBreach = args.includes("--breach");
const sensorId = getArg("--sensor", "SIM-UNO-R4-99");
const brokerUrl = getArg("--broker", process.env.MQTT_BROKER_URL || "mqtt://localhost:1883");
const topic = getArg("--topic", process.env.MQTT_TOPIC ? process.env.MQTT_TOPIC.replace("#", "simulated") : "logitrust/telemetry/simulated");
const secret = process.env.DEVICE_SECRET || "logitrust_hardware_key_2026";

const startCoords = CITY_COORDS[originCity] || [19.0760, 72.8777];
const endCoords = CITY_COORDS[destCity] || [18.5204, 73.8567];

console.log("==================================================");
console.log("🚛  LogiTrust Telemetry Simulator");
console.log(`Shipment:   ${shipmentId}`);
console.log(`Route:      ${originCity} [${startCoords}] → ${destCity} [${endCoords}]`);
console.log(`Cadence:    ${cadenceSec}s per update`);
console.log(`Steps:      ${totalSteps}`);
console.log(`Breach:     ${isBreach ? "YES (triggering maxTemp violation)" : "NO (normal temp 4-6°C)"}`);
console.log(`Broker:     ${brokerUrl}`);
console.log(`Topic:      ${topic}`);
console.log("==================================================");

const client = mqtt.connect(brokerUrl);

client.on("connect", () => {
  console.log(`✅ Connected to MQTT broker at ${brokerUrl}`);
  startSimulation();
});

client.on("error", (err) => {
  console.error("❌ MQTT Connection Error:", err.message);
  process.exit(1);
});

async function startSimulation() {
  let step = 0;

  const interval = setInterval(() => {
    step++;
    const progress = Math.min(1.0, step / totalSteps);

    // Linear interpolation between origin and destination
    let lat = startCoords[0] + (endCoords[0] - startCoords[0]) * progress;
    let lon = startCoords[1] + (endCoords[1] - startCoords[1]) * progress;

    // Add slight random noise (unless within final 3 steps of destination)
    if (step < totalSteps - 2) {
      lat += (Math.random() - 0.5) * 0.003;
      lon += (Math.random() - 0.5) * 0.003;
    } else {
      // Final steps: ensure exact destination proximity (< 200m) to trigger geofence arrival
      lat = endCoords[0] + (Math.random() - 0.5) * 0.0005;
      lon = endCoords[1] + (Math.random() - 0.5) * 0.0005;
    }

    // Realistic telemetry
    const temperature = isBreach ? 18.5 + (Math.random() * 2.0) : 5.0 + (Math.random() * 1.2);
    const humidity = 55.0 + (Math.random() * 5.0);
    const timestamp = Math.floor(Date.now() / 1000);
    const tempStr = Number(temperature).toFixed(1);
    const humStr = Number(humidity).toFixed(1);
    const latStr = Number(lat).toFixed(6);
    const lonStr = Number(lon).toFixed(6);

    // Cryptographic signature: HMAC-SHA256 over ALL fields
    const hmacMessage = `${sensorId}:${timestamp}:${tempStr}:${humStr}:${latStr}:${lonStr}:true`;
    const signature = "0x" + crypto.createHmac("sha256", secret).update(hmacMessage).digest("hex");

    const payload = {
      shipmentId,
      sensorId,
      timestamp,
      temperature: parseFloat(tempStr),
      humidity: parseFloat(humStr),
      latitude: parseFloat(latStr),
      longitude: parseFloat(lonStr),
      gpsLock: true,
      sim: true,
      signature,
    };

    const payloadStr = JSON.stringify(payload);
    client.publish(topic, payloadStr, (err) => {
      if (err) {
        console.error(`[Step ${step}/${totalSteps}] Publish failed:`, err.message);
      } else {
        const atDest = step >= totalSteps - 2 ? " [🎯 DESTINATION GEOFENCE]" : "";
        console.log(`[Step ${step}/${totalSteps}] Published telemetry: Temp=${tempStr}°C, Coords=(${payload.latitude}, ${payload.longitude})${atDest}`);
      }
    });

    if (step >= totalSteps) {
      clearInterval(interval);
      console.log("\n🏁 Simulation complete. Route fully traversed and final readings delivered.");
      setTimeout(() => {
        client.end();
        process.exit(0);
      }, 1000);
    }
  }, cadenceSec * 1000);
}
