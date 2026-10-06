import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { processSensorTelemetry } from "../services/sensorProcessor.js";

const prisma = new PrismaClient();
const router = Router();

const sensorPayloadSchema = z.object({
  shipmentId: z.string().optional(),
  timestamp: z.number().int().positive(),
  temperature: z.number(),
  humidity: z.number(),
  latitude: z.number(),
  longitude: z.number(),
  gpsLock: z.boolean(),
  sensorId: z.string().min(1),
  signature: z.string().min(1),
});

// This is the endpoint your ESP32 (or the simulator script) POSTs signed payloads to.
// It does NOT require Google OAuth — devices authenticate via their signature instead.
router.post("/", async (req, res) => {
  try {
    const validated = sensorPayloadSchema.parse(req.body);
    const { shipmentId, timestamp, temperature, humidity, latitude: lat, longitude: lon, gpsLock, sensorId, signature } = validated;

    // TODO Phase 2: verify `signature` against the registered device public key before trusting the payload.

    const result = await processSensorTelemetry(validated);

    res.status(201).json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    res.status(500).json({ error: err.message });
  }
});

export default router;
