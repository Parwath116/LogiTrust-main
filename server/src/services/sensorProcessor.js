import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { disputeEscrowOnChain } from "./blockchain.js";
import { sendDisputeEmail } from "./emailService.js";

const prisma = new PrismaClient();

export async function processSensorTelemetry(payload) {
  // payload expects: { shipmentId, timestamp, temperature, humidity, latitude: lat, longitude: lon, gpsLock, sensorId, signature }
  const { shipmentId, timestamp, temperature, humidity, latitude: lat, longitude: lon, gpsLock, sensorId, signature } = payload;
  
  // Fallback to default location if no GPS lock
  let finalLat = lat;
  let finalLon = lon;
  let finalGpsLock = gpsLock;
  let simulatedLocation = false;
  
  if (!gpsLock || (lat === 0 && lon === 0)) {
    finalLat = 19.0760;
    finalLon = 72.8777;
    simulatedLocation = true;
  }

  let shipment;
  if (shipmentId) {
    shipment = await prisma.shipment.findUnique({ where: { shipmentCode: shipmentId } });
  } else if (sensorId) {
    shipment = await prisma.shipment.findFirst({
      where: { assignedSensorId: sensorId, status: { in: ["PENDING", "IN_TRANSIT", "DISPUTED"] } },
      orderBy: { createdAt: "desc" }
    });
  }
  if (!shipment) throw new Error("Unknown shipment or unassigned sensor");

  // Validate Cryptographic Signature
  const secret = process.env.DEVICE_SECRET || "logitrust_hardware_key_2026";
  const tempStr = Number(temperature).toFixed(1);
  const rawData = `${secret}${sensorId}${timestamp}${tempStr}`;
  const expectedSig = "0x" + crypto.createHash('sha256').update(rawData).digest('hex');

  if (signature !== expectedSig) {
    console.error(`[SECURITY] Invalid signature from sensor ${sensorId}. Expected ${expectedSig}, got ${signature}`);
    throw new Error("Invalid cryptographic signature");
  }

  const breached = temperature > shipment.maxTemp || humidity > shipment.maxHumidity;

  const reading = await prisma.sensorReading.create({
    data: {
      shipmentId: shipment.id,
      timestamp: new Date(),

      temperature,
      humidity,
      lat: finalLat,
      lon: finalLon,
      gpsLock: finalGpsLock,
      simulatedLocation,
      sensorId,
      signature,
      breached,
    },
  });

  // Normalize live readings against baseline max thresholds before inference.
  let riskScore = shipment.riskScore;
  try {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const duration_hrs = (currentTimestamp - Math.floor(shipment.createdAt.getTime() / 1000)) / 3600;
    
    const maxTempRecord = await prisma.sensorReading.aggregate({
      _max: { temperature: true },
      where: { shipmentId: shipment.id },
    });
    const max_temp_spike = Math.max(maxTempRecord._max.temperature || temperature, temperature);

    const normalized_temp = temperature - shipment.maxTemp + 8;
    const normalized_max_spike = max_temp_spike - shipment.maxTemp + 8;
    const normalized_humidity = humidity - shipment.maxHumidity + 60;

    const aiRes = await fetch(`${process.env.AI_SERVICE_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        temperature: normalized_temp, 
        humidity: normalized_humidity, 
        category: "general",
        duration_hrs: Math.max(0, duration_hrs),
        max_temp_spike: normalized_max_spike
      }),
    });
    const aiData = await aiRes.json();
    riskScore = aiData.risk_score;
  } catch (err) {
    console.warn("AI service unavailable:", err.message);
  }

  // Determine if we should change the shipment status to DISPUTED.
  // Enforce continuous breach duration threshold before marking as disputed.
  let shouldDispute = false;
  if (breached && shipment.status !== "DELIVERED") {
    const recentReadings = await prisma.sensorReading.findMany({
      where: { shipmentId: shipment.id },
      orderBy: { timestamp: "desc" },
      take: 12,
    });
    
    // Only dispute if we have at least 12 readings and ALL of them were breached
    if (recentReadings.length >= 12 && recentReadings.every(r => r.breached)) {
      shouldDispute = true;
    }
  }

  const newStatus = (shipment.status === "DISPUTED" || shouldDispute)
    ? "DISPUTED"
    : (shipment.status === "PENDING" ? "IN_TRANSIT" : shipment.status);

  // Execute on-chain revocation on state transition.
  if (shouldDispute && shipment.status !== "DISPUTED") {
    try {
      console.log(`[Smart Contract] Automatically disputing shipment ${shipment.shipmentCode} on-chain due to continuous breach.`);
      await disputeEscrowOnChain(shipment.shipmentCode);

      // Create a notification for the receiver if they exist
      if (shipment.receiverId || shipment.receiverEmail) {
        if (shipment.receiverId) {
          await prisma.notification.create({
            data: {
              userId: shipment.receiverId,
              message: `Your shipment ${shipment.shipmentCode} has been automatically revoked due to continuous temperature breach. Escrow refunded.`,
            }
          });
        }
        
        sendDisputeEmail(shipment, "AI automatically flagged shipment due to critical temperature breach over time threshold.");
      }
    } catch (err) {
      console.error(`[Smart Contract] Failed to auto-dispute ${shipment.shipmentCode}:`, err);
    }
  }

  await prisma.shipment.update({
    where: { id: shipment.id },
    data: {
      riskScore,
      status: newStatus,
    },
  });

  return { reading, riskScore, breached };
}
