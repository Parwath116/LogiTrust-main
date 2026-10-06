import mqtt from "mqtt";
import { processSensorTelemetry } from "./sensorProcessor.js";

// Mosquitto broker is running in docker-compose as "mqtt", or use Cloud MQTT from .env
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
const MQTT_TOPIC = process.env.MQTT_TOPIC || "logitrust/telemetry/#";

export function mqttTopicMatches(filter, topic) {
  if (filter === topic) return true;
  const filterParts = filter.split("/");
  const topicParts = topic.split("/");

  for (let i = 0; i < filterParts.length; i++) {
    const f = filterParts[i];
    if (f === "#") {
      return true;
    }
    if (i >= topicParts.length) {
      return false;
    }
    if (f === "+") {
      continue;
    }
    if (f !== topicParts[i]) {
      return false;
    }
  }
  return filterParts.length === topicParts.length;
}

export function startMqttService() {
  const client = mqtt.connect(MQTT_BROKER_URL);

  client.on("connect", () => {
    console.log(`Connected to MQTT broker at ${MQTT_BROKER_URL}`);
    // Subscribe to all matching sensor telemetry topics
    client.subscribe(MQTT_TOPIC, (err) => {
      if (err) console.error("MQTT subscription error:", err);
      else console.log(`Subscribed to MQTT topic pattern: ${MQTT_TOPIC}`);
    });
  });

  client.on("message", async (topic, message) => {
    if (mqttTopicMatches(MQTT_TOPIC, topic)) {
      try {
        const payload = JSON.parse(message.toString());
        // Process the payload exactly like the HTTP API
        await processSensorTelemetry(payload);
        console.log(`Successfully processed MQTT telemetry for sensor: ${payload.sensorId} from topic: ${topic}`);
      } catch (err) {
        console.error("Failed to process MQTT telemetry:", err.message);
      }
    }
  });

  client.on("error", (err) => {
    console.error("MQTT client error:", err);
  });
}
