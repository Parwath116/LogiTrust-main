import mqtt from "mqtt";
import { processSensorTelemetry } from "./sensorProcessor.js";

// Mosquitto broker is running in docker-compose as "mqtt", or use Cloud MQTT from .env
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
const MQTT_TOPIC = process.env.MQTT_TOPIC || "sensors/telemetry";

export function startMqttService() {
  const client = mqtt.connect(MQTT_BROKER_URL);

  client.on("connect", () => {
    console.log(`Connected to MQTT broker at ${MQTT_BROKER_URL}`);
    // Subscribe to all sensor telemetry topics
    client.subscribe(MQTT_TOPIC, (err) => {
      if (err) console.error("MQTT subscription error:", err);
      else console.log(`Subscribed to MQTT topic: ${MQTT_TOPIC}`);
    });
  });

  client.on("message", async (topic, message) => {
    if (topic === MQTT_TOPIC) {
      try {
        const payload = JSON.parse(message.toString());
        // Process the payload exactly like the HTTP API
        await processSensorTelemetry(payload);
        console.log(`Successfully processed MQTT telemetry for sensor: ${payload.sensorId}`);
      } catch (err) {
        console.error("Failed to process MQTT telemetry:", err.message);
      }
    }
  });

  client.on("error", (err) => {
    console.error("MQTT client error:", err);
  });
}
