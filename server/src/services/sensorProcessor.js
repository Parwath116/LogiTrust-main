import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import {
  disputeEscrowOnChain,
  flagTemperatureBreachOnChain,
  updateShipmentStatusOnChain,
  markGeoFenceOnChain,
} from "./blockchain.js";
import { haversineDistanceMeters, resolveCityCoordinates } from "../utils/geo.js";
import { sendDisputeEmail } from "./emailService.js";

const prisma = new PrismaClient();

export function timingSafeEqualStrings(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a.toLowerCase());
  const bufB = Buffer.from(b.toLowerCase());
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function computeSensorHmac(sensorId, timestamp, temperature, humidity, lat, lon, gpsLock, secret) {
  const tempStr = Number(temperature).toFixed(1);
  const humStr = Number(humidity).toFixed(1);
  const latStr = Number(lat).toFixed(6);
  const lonStr = Number(lon).toFixed(6);
  const gpsLockStr = Boolean(gpsLock).toString();

  const hmacMessage = `${sensorId}:${timestamp}:${tempStr}:${humStr}:${latStr}:${lonStr}:${gpsLockStr}`;
  return "0x" + crypto.createHmac("sha256", secret).update(hmacMessage).digest("hex");
}

export function getItemCategory(itemStr) {
  if (!itemStr || typeof itemStr !== "string") return "general";
  const lower = itemStr.toLowerCase();
  if (lower.includes("pharma") || lower.includes("vaccine") || lower.includes("med")) return "pharma";
  if (lower.includes("dairy") || lower.includes("milk") || lower.includes("cheese")) return "dairy";
  if (lower.includes("produce") || lower.includes("fruit") || lower.includes("veg") || lower.includes("fish") || lower.includes("meat")) return "produce";
  if (lower.includes("electronic") || lower.includes("chip") || lower.includes("circuit")) return "electronics";
  return "general";
}

export async function processSensorTelemetry(payload) {
  // payload expects: { shipmentId, timestamp, temperature, humidity, latitude: lat, longitude: lon, gpsLock, sensorId, signature, sim, source }
  const { shipmentId, timestamp, temperature, humidity, latitude: lat, longitude: lon, gpsLock, sensorId, signature } = payload;
  
  const isSimulated = Boolean(payload.sim || payload.source === "SIMULATED");
  const readingSource = isSimulated ? "SIMULATED" : "GPS";

  let finalLat = Number(lat) || 0;
  let finalLon = Number(lon) || 0;
  let finalGpsLock = Boolean(gpsLock);

  // Stop overwriting no-fix readings with Mumbai coordinates.
  // If no GPS fix, preserve false and do not inject fake coordinates.
  if (!finalGpsLock || (finalLat === 0 && finalLon === 0)) {
    finalGpsLock = false;
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

  // Per-Device Auth: Lookup or auto-provision sensor record
  if (!process.env.DEVICE_SECRET) {
    throw new Error("DEVICE_SECRET is not configured on server");
  }

  let sensorRecord = await prisma.sensor.findUnique({ where: { sensorId } });
  if (!sensorRecord) {
    sensorRecord = await prisma.sensor.create({
      data: {
        sensorId,
        secretKey: process.env.DEVICE_SECRET,
        active: true,
      },
    });
  }
  if (!sensorRecord.active) {
    throw new Error(`Sensor ${sensorId} is inactive or deactivated`);
  }
  const deviceSecret = sensorRecord.secretKey;

  // Replay Protection & Timestamp freshness (|server time - timestamp| <= 60s)
  const incomingTimeSec = Number(timestamp);
  const serverTimeSec = Math.floor(Date.now() / 1000);
  if (isNaN(incomingTimeSec) || Math.abs(serverTimeSec - incomingTimeSec) > 60) {
    throw new Error(`Telemetry timestamp expired or out of allowed window (|${serverTimeSec - incomingTimeSec}|s > 60s)`);
  }

  const existingReading = await prisma.sensorReading.findFirst({
    where: {
      sensorId,
      timestamp: new Date(incomingTimeSec * 1000),
    },
  });
  if (existingReading) {
    throw new Error(`Replay attack detected: telemetry for sensor ${sensorId} at timestamp ${incomingTimeSec} already processed`);
  }


  // Validate Cryptographic Signature: HMAC-SHA256 over ALL fields
  const expectedHmac = computeSensorHmac(sensorId, timestamp, temperature, humidity, finalLat, finalLon, finalGpsLock, deviceSecret);

  // Backward compatibility with legacy SHA256 formats
  const tempStr = Number(temperature).toFixed(1);
  const rawDataSim = `${deviceSecret}${sensorId}${timestamp}${tempStr}sim:true`;
  const rawDataStd = `${deviceSecret}${sensorId}${timestamp}${tempStr}`;
  const sigSim = "0x" + crypto.createHash("sha256").update(rawDataSim).digest("hex");
  const sigStd = "0x" + crypto.createHash("sha256").update(rawDataStd).digest("hex");

  const validSig =
    timingSafeEqualStrings(signature, expectedHmac) ||
    (isSimulated && timingSafeEqualStrings(signature, sigSim)) ||
    timingSafeEqualStrings(signature, sigStd);

  if (!validSig) {
    console.error(`[SECURITY] Invalid signature from sensor ${sensorId}. Expected HMAC ${expectedHmac}, got ${signature}`);
    throw new Error("Invalid cryptographic signature");
  }

  const breached = temperature > shipment.maxTemp || humidity > shipment.maxHumidity;

  if (breached && temperature > shipment.maxTemp) {
    if (process.env.SMART_ESCROW_ADDRESS && process.env.DEPLOYER_PRIVATE_KEY) {
      try {
        await flagTemperatureBreachOnChain(shipment.shipmentCode);
      } catch (err) {
        console.warn(`[Smart Contract] Failed to flag temperature breach on-chain for ${shipment.shipmentCode}:`, err.message);
      }
    }
  }

  const reading = await prisma.sensorReading.create({
    data: {
      shipmentId: shipment.id,
      timestamp: new Date(incomingTimeSec * 1000),

      temperature,
      humidity,
      lat: finalLat,
      lon: finalLon,
      gpsLock: finalGpsLock,
      source: readingSource,
      sensorId,
      signature,
      breached,
    },
  });

  // Server-side Geofence Arrival Check
  if (!shipment.arrivedAt) {
    let destLat = shipment.destLat;
    let destLon = shipment.destLon;
    if (destLat == null || destLon == null) {
      const resolved = await resolveCityCoordinates(shipment.destination);
      if (resolved) {
        destLat = resolved.lat;
        destLon = resolved.lon;
        await prisma.shipment.update({
          where: { id: shipment.id },
          data: { destLat, destLon },
        });
      }
    }

    if (destLat != null && destLon != null) {
      const GEOFENCE_RADIUS_M = parseFloat(process.env.GEOFENCE_RADIUS_M || "500");

      // Check latest 3 readings (including the one just created)
      const recentReadings = await prisma.sensorReading.findMany({
        where: { shipmentId: shipment.id },
        orderBy: { timestamp: "desc" },
        take: 3,
      });

      if (recentReadings.length >= 3) {
        const allWithinGeofence = recentReadings.every((r) => {
          if (!r.gpsLock) return false;
          const dist = haversineDistanceMeters(r.lat, r.lon, destLat, destLon);
          return dist <= GEOFENCE_RADIUS_M;
        });

        if (allWithinGeofence) {
          const arrivalTime = new Date();
          console.log(`[Geofence] Shipment ${shipment.shipmentCode} arrived at destination. Marking arrivedAt.`);
          shipment = await prisma.shipment.update({
            where: { id: shipment.id },
            data: { arrivedAt: arrivalTime },
          });

          if (process.env.SMART_ESCROW_ADDRESS && process.env.DEPLOYER_PRIVATE_KEY) {
            try {
              console.log(`[Smart Contract] Marking geo-fence on-chain for ${shipment.shipmentCode}...`);
              await markGeoFenceOnChain(shipment.shipmentCode);
            } catch (err) {
              console.warn(`[Smart Contract] Failed to mark geo-fence on-chain for ${shipment.shipmentCode}:`, err.message);
            }
          }
        }
      }
    }
  }

  // Calculate real features relative to baseline max thresholds for AI inference.
  let riskScore = shipment.riskScore;
  try {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const duration_hrs = Math.max(0, (currentTimestamp - Math.floor(shipment.createdAt.getTime() / 1000)) / 3600);
    
    const maxTempRecord = await prisma.sensorReading.aggregate({
      _max: { temperature: true },
      where: { shipmentId: shipment.id },
    });
    const max_temp_spike = Math.max(maxTempRecord._max.temperature || temperature, temperature);

    const temp_rel = Number((temperature - shipment.maxTemp).toFixed(2));
    const spike_rel = Number((max_temp_spike - shipment.maxTemp).toFixed(2));
    const category = getItemCategory(shipment.item);

    const aiRes = await fetch(`${process.env.AI_SERVICE_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        temperature,
        max_temp: shipment.maxTemp,
        temp_rel,
        max_temp_spike,
        spike_rel,
        humidity,
        category,
        duration_hrs: Math.round(duration_hrs * 100) / 100,
      }),
    });
    const aiData = await aiRes.json();
    if (typeof aiData.risk_score === "number") {
      riskScore = aiData.risk_score;
    }
  } catch (err) {
    console.warn("AI service unavailable:", err.message);
  }

  // --- RULE-BASED DISPUTE LOGIC ---
  // A shipment is automatically disputed if it incurs N consecutive breaches within BREACH_WINDOW_MIN minutes.
  const breachConsecutiveCount = parseInt(process.env.BREACH_CONSECUTIVE_COUNT || "3", 10);
  const breachWindowMin = parseInt(process.env.BREACH_WINDOW_MIN || "15", 10);
  const breachWindowStart = new Date(Date.now() - breachWindowMin * 60 * 1000);

  let shouldDispute = false;
  if (breached && shipment.status !== "DELIVERED" && shipment.status !== "RESOLVED" && shipment.status !== "REFUNDED") {
    const recentReadings = await prisma.sensorReading.findMany({
      where: {
        shipmentId: shipment.id,
        timestamp: { gte: breachWindowStart },
      },
      orderBy: { timestamp: "desc" },
      take: breachConsecutiveCount,
    });
    
    // Dispute when at least N readings are recorded in the window and ALL of them are breached
    if (recentReadings.length >= breachConsecutiveCount && recentReadings.every(r => r.breached)) {
      shouldDispute = true;
      console.warn(`[RULE BREACH] Shipment ${shipment.shipmentCode} breached ${breachConsecutiveCount} consecutive times within ${breachWindowMin}m window. Triggering dispute.`);
    }
  }

  // --- AI RISK SCORE: FLAG-FOR-ADMIN SIGNAL ---
  // AI score serves as an advisory anomaly signal. When riskScore >= AI_DISPUTE_THRESHOLD, flag for admin review.
  const aiDisputeThreshold = parseFloat(process.env.AI_DISPUTE_THRESHOLD || "80");
  let shouldAdminFlag = shipment.adminFlagged;
  if (!shouldAdminFlag && typeof riskScore === "number" && riskScore >= aiDisputeThreshold) {
    shouldAdminFlag = true;
    console.warn(`[AI ADVISORY] High spoilage risk detected (${riskScore}% >= ${aiDisputeThreshold}%). Flagging shipment ${shipment.shipmentCode} for admin review.`);
    if (shipment.receiverId) {
      await prisma.notification.create({
        data: {
          userId: shipment.receiverId,
          message: `AI detected high spoilage risk (${riskScore}%) for shipment ${shipment.shipmentCode}. Flagged for Admin review.`,
        },
      }).catch(err => console.warn("Failed to create AI notification:", err.message));
    }
  }

  const newStatus = (shipment.status === "DISPUTED" || shouldDispute)
    ? "DISPUTED"
    : (shipment.status === "PENDING" ? "IN_TRANSIT" : shipment.status);

  // Execute on-chain dispute on state transition to DISPUTED
  if (shouldDispute && shipment.status !== "DISPUTED") {
    if (process.env.SMART_ESCROW_ADDRESS && process.env.DEPLOYER_PRIVATE_KEY) {
      try {
        console.log(`[Smart Contract] Automatically disputing shipment ${shipment.shipmentCode} on-chain due to sustained rule breach.`);
        await disputeEscrowOnChain(shipment.shipmentCode);
      } catch (err) {
        console.error(`[Smart Contract] Failed to auto-dispute ${shipment.shipmentCode}:`, err);
      }
    }

    // Create a notification for the receiver if they exist
    if (shipment.receiverId || shipment.receiverEmail) {
      if (shipment.receiverId) {
        await prisma.notification.create({
          data: {
            userId: shipment.receiverId,
            message: `Your shipment ${shipment.shipmentCode} has been disputed due to continuous temperature breach. Escrow locked pending admin review.`,
          }
        }).catch(err => console.warn("Failed to create dispute notification:", err.message));
      }
      
      sendDisputeEmail(shipment, "Sustained temperature breach exceeded rule threshold over configured window.");
    }
  }

  if (newStatus !== shipment.status) {
    if (process.env.SHIPMENT_REGISTRY_ADDRESS && process.env.DEPLOYER_PRIVATE_KEY) {
      try {
        await updateShipmentStatusOnChain(shipment.shipmentCode, newStatus);
      } catch (err) {
        console.warn(`[Smart Contract] Failed to update registry status on-chain for ${shipment.shipmentCode}:`, err.message);
      }
    }
  }

  await prisma.shipment.update({
    where: { id: shipment.id },
    data: {
      riskScore,
      status: newStatus,
      adminFlagged: shouldAdminFlag,
    },
  });

  return { reading, riskScore, breached };
}
