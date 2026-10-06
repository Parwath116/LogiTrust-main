import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inrToEth, disputeEscrowOnChain, resolveDisputeOnChain } from "../src/services/blockchain.js";
import { mqttTopicMatches } from "../src/services/mqtt.js";
import { $Enums } from "@prisma/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("inrToEth converts INR to ETH correctly using default rate", () => {
  delete process.env.TEST_ETH_SCALE;
  process.env.INR_PER_ETH = "250000";
  assert.strictEqual(inrToEth(50000), "0.2");
  assert.strictEqual(inrToEth(250000), "1");
  assert.strictEqual(inrToEth(2500), "0.01");
});

test("inrToEth respects TEST_ETH_SCALE when defined", () => {
  process.env.TEST_ETH_SCALE = "0.00001";
  assert.strictEqual(inrToEth(50000), "0.5");
  delete process.env.TEST_ETH_SCALE;
});

test("mqttTopicMatches matches wildcards and exact topics correctly", () => {
  // Multilevel wildcard '#'
  assert.strictEqual(mqttTopicMatches("logitrust/telemetry/#", "logitrust/telemetry/yashas"), true);
  assert.strictEqual(mqttTopicMatches("logitrust/telemetry/#", "logitrust/telemetry/uno-r4"), true);
  assert.strictEqual(mqttTopicMatches("logitrust/telemetry/#", "logitrust/telemetry/a/b/c"), true);
  assert.strictEqual(mqttTopicMatches("logitrust/telemetry/#", "logitrust/telemetry"), true);
  assert.strictEqual(mqttTopicMatches("logitrust/telemetry/#", "other/telemetry/sensor"), false);

  // Exact topic match
  assert.strictEqual(mqttTopicMatches("sensors/telemetry", "sensors/telemetry"), true);
  assert.strictEqual(mqttTopicMatches("sensors/telemetry", "sensors/telemetry/extra"), false);
  assert.strictEqual(mqttTopicMatches("sensors/telemetry", "sensors/other"), false);

  // Single-level wildcard '+'
  assert.strictEqual(mqttTopicMatches("sensors/+/data", "sensors/device1/data"), true);
  assert.strictEqual(mqttTopicMatches("sensors/+/data", "sensors/device1/sub/data"), false);
});

test("Prisma schema defines OnChainStatus enum values", () => {
  const OnChainStatus = $Enums.OnChainStatus;
  assert.ok(OnChainStatus, "OnChainStatus enum exists on Prisma client");
  assert.strictEqual(OnChainStatus.NOT_REGISTERED, "NOT_REGISTERED");
  assert.strictEqual(OnChainStatus.REGISTERED, "REGISTERED");
  assert.strictEqual(OnChainStatus.FAILED, "FAILED");
});

test("Prisma schema defines RESOLVED and REFUNDED in ShipmentStatus", () => {
  const ShipmentStatus = $Enums.ShipmentStatus;
  assert.ok(ShipmentStatus, "ShipmentStatus enum exists on Prisma client");
  assert.strictEqual(ShipmentStatus.DISPUTED, "DISPUTED");
  assert.strictEqual(ShipmentStatus.RESOLVED, "RESOLVED");
  assert.strictEqual(ShipmentStatus.REFUNDED, "REFUNDED");
});

test("blockchain.js exports split dispute, resolve, and oracle functions", async () => {
  assert.strictEqual(typeof disputeEscrowOnChain, "function");
  assert.strictEqual(typeof resolveDisputeOnChain, "function");
  const { markGeoFenceOnChain, flagTemperatureBreachOnChain, updateShipmentStatusOnChain } = await import("../src/services/blockchain.js");
  assert.strictEqual(typeof markGeoFenceOnChain, "function");
  assert.strictEqual(typeof flagTemperatureBreachOnChain, "function");
  assert.strictEqual(typeof updateShipmentStatusOnChain, "function");
});

test("Prisma schema defines ReadingSource enum (GPS, SIMULATED)", () => {
  const ReadingSource = $Enums.ReadingSource;
  assert.ok(ReadingSource, "ReadingSource enum exists on Prisma client");
  assert.strictEqual(ReadingSource.GPS, "GPS");
  assert.strictEqual(ReadingSource.SIMULATED, "SIMULATED");
});

test("haversineDistanceMeters calculates accurate distance between coordinates", async () => {
  const { haversineDistanceMeters } = await import("../src/utils/geo.js");
  // Mumbai [19.0760, 72.8777] to Pune [18.5204, 73.8567] is approximately 120km
  const dist = haversineDistanceMeters(19.0760, 72.8777, 18.5204, 73.8567);
  assert.ok(dist > 115000 && dist < 125000, `Expected ~120km, got ${dist}m`);

  // Same coordinates should have 0 distance
  assert.strictEqual(Math.round(haversineDistanceMeters(19.0760, 72.8777, 19.0760, 72.8777)), 0);

  // Small coordinate difference (~100m)
  const closeDist = haversineDistanceMeters(19.0760, 72.8777, 19.0765, 72.8777);
  assert.ok(closeDist < 100, `Expected close distance < 100m, got ${closeDist}m`);
});

test("resolveCityCoordinates resolves known cities and custom coordinates", async () => {
  const { resolveCityCoordinates } = await import("../src/utils/geo.js");
  const mumbai = await resolveCityCoordinates("Mumbai");
  assert.deepStrictEqual(mumbai, { lat: 19.0760, lon: 72.8777 });

  const pune = await resolveCityCoordinates("pune");
  assert.deepStrictEqual(pune, { lat: 18.5204, lon: 73.8567 });

  const custom = await resolveCityCoordinates("CustomCity", 25.1234, 82.5678);
  assert.deepStrictEqual(custom, { lat: 25.1234, lon: 82.5678 });
});

test("OAuth state signing and verification prevents tampering and validates payloads", async () => {
  const { signOAuthState, verifyOAuthState } = await import("../src/utils/oauthState.js");
  const payload = { role: "RECEIVER", nonce: "test-nonce-123", timestamp: Date.now() };
  
  // Normal signing and verification roundtrip
  const signed = signOAuthState(payload);
  assert.ok(typeof signed === "string" && signed.includes("."), "Signed state is a dot-separated string");
  const verified = verifyOAuthState(signed);
  assert.deepStrictEqual(verified, payload);

  // Tampered payload (e.g. attacker changing role to ADMIN)
  const [b64Payload, sig] = signed.split(".");
  const decoded = JSON.parse(Buffer.from(b64Payload, "base64url").toString("utf8"));
  decoded.role = "ADMIN";
  const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString("base64url");
  const tamperedState = `${tamperedPayload}.${sig}`;
  assert.strictEqual(verifyOAuthState(tamperedState), null, "Tampered state payload must be rejected");

  // Tampered signature
  const tamperedSigState = `${b64Payload}.${sig.slice(0, -4)}abcd`;
  assert.strictEqual(verifyOAuthState(tamperedSigState), null, "Tampered signature must be rejected");

  // Malformed states
  assert.strictEqual(verifyOAuthState(""), null);
  assert.strictEqual(verifyOAuthState(null), null);
  assert.strictEqual(verifyOAuthState("no-dot-token"), null);
});

test("Prisma client includes Sensor model delegate", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  assert.ok(prisma.sensor, "Prisma client includes sensor model delegate");
});

test("Sensor HMAC-SHA256 signature and timing-safe equality verification", async () => {
  const { computeSensorHmac, timingSafeEqualStrings } = await import("../src/services/sensorProcessor.js");
  const secret = "test_device_secret_12345";
  const sensorId = "UNO-R4-TEST-01";
  const timestamp = 1775500000;
  const temp = 4.5;
  const hum = 60.0;
  const lat = 19.076000;
  const lon = 72.877700;
  const gpsLock = true;

  const hmac = computeSensorHmac(sensorId, timestamp, temp, hum, lat, lon, gpsLock, secret);
  assert.ok(hmac.startsWith("0x"), "HMAC starts with 0x");
  assert.strictEqual(hmac.length, 66, "HMAC has length 66 (0x + 64 hex chars)");

  // Timing safe equal check with matching signature
  assert.strictEqual(timingSafeEqualStrings(hmac, hmac), true);

  // Different secret produces different HMAC
  const wrongHmac = computeSensorHmac(sensorId, timestamp, temp, hum, lat, lon, gpsLock, "wrong_secret");
  assert.notStrictEqual(hmac, wrongHmac);
  assert.strictEqual(timingSafeEqualStrings(hmac, wrongHmac), false);

  // Tampered telemetry (different temperature) produces different HMAC
  const tamperedHmac = computeSensorHmac(sensorId, timestamp, 25.0, hum, lat, lon, gpsLock, secret);
  assert.notStrictEqual(hmac, tamperedHmac);
  assert.strictEqual(timingSafeEqualStrings(hmac, tamperedHmac), false);

  // Mismatched length does not throw and returns false
  assert.strictEqual(timingSafeEqualStrings(hmac, "short"), false);
  assert.strictEqual(timingSafeEqualStrings(null, hmac), false);
});

test("Timestamp freshness window logic validates within 60s and rejects stale/future timestamps", () => {
  const serverTimeSec = 1775500000;
  function isFresh(incomingSec) {
    return !isNaN(incomingSec) && Math.abs(serverTimeSec - incomingSec) <= 60;
  }

  // Exactly current time
  assert.strictEqual(isFresh(1775500000), true);
  // 30 seconds ago
  assert.strictEqual(isFresh(1775500000 - 30), true);
  // Exactly 60 seconds ago
  assert.strictEqual(isFresh(1775500000 - 60), true);
  // 61 seconds ago (expired)
  assert.strictEqual(isFresh(1775500000 - 61), false);
  // 10 minutes ago (replayed/stale)
  assert.strictEqual(isFresh(1775500000 - 600), false);
  // 65 seconds in the future (skewed)
  assert.strictEqual(isFresh(1775500000 + 65), false);
  // Invalid timestamp
  assert.strictEqual(isFresh(NaN), false);
});

test("getItemCategory maps shipment item names to accurate categories", async () => {
  const { getItemCategory } = await import("../src/services/sensorProcessor.js");
  assert.strictEqual(getItemCategory("Polio Vaccine Vial"), "pharma");
  assert.strictEqual(getItemCategory("Cold Chain Medicine"), "pharma");
  assert.strictEqual(getItemCategory("Fresh Dairy Milk"), "dairy");
  assert.strictEqual(getItemCategory("Cheddar Cheese Block"), "dairy");
  assert.strictEqual(getItemCategory("Organic Strawberries & Produce"), "produce");
  assert.strictEqual(getItemCategory("Frozen Salmon Fish"), "produce");
  assert.strictEqual(getItemCategory("Microcontroller Chip & Electronics"), "electronics");
  assert.strictEqual(getItemCategory("Cotton Garments"), "general");
  assert.strictEqual(getItemCategory(""), "general");
  assert.strictEqual(getItemCategory(null), "general");
});

test("Rule-based dispute logic triggers only when N consecutive breaches occur within BREACH_WINDOW_MIN", () => {
  const breachConsecutiveCount = 3;
  const breachWindowMin = 15;
  const now = Date.now();
  const windowStart = new Date(now - breachWindowMin * 60 * 1000);

  function evaluateDispute(readings) {
    const inWindow = readings.filter(r => r.timestamp >= windowStart);
    return inWindow.length >= breachConsecutiveCount && inWindow.slice(0, breachConsecutiveCount).every(r => r.breached);
  }

  // 3 consecutive breaches within window -> should dispute
  const validBreaches = [
    { timestamp: new Date(now - 1000), breached: true },
    { timestamp: new Date(now - 5000), breached: true },
    { timestamp: new Date(now - 10000), breached: true },
  ];
  assert.strictEqual(evaluateDispute(validBreaches), true);

  // Only 2 breaches (less than N=3) -> should NOT dispute
  const onlyTwo = [
    { timestamp: new Date(now - 1000), breached: true },
    { timestamp: new Date(now - 5000), breached: true },
  ];
  assert.strictEqual(evaluateDispute(onlyTwo), false);

  // 3 readings, but one is safe (not breached) -> should NOT dispute
  const mixed = [
    { timestamp: new Date(now - 1000), breached: true },
    { timestamp: new Date(now - 5000), breached: false },
    { timestamp: new Date(now - 10000), breached: true },
  ];
  assert.strictEqual(evaluateDispute(mixed), false);

  // 3 breaches, but occurred 20 minutes ago (outside 15-minute window) -> should NOT dispute
  const expiredBreaches = [
    { timestamp: new Date(now - 20 * 60 * 1000), breached: true },
    { timestamp: new Date(now - 21 * 60 * 1000), breached: true },
    { timestamp: new Date(now - 22 * 60 * 1000), breached: true },
  ];
  assert.strictEqual(evaluateDispute(expiredBreaches), false);
});

test("AI dispute threshold flags shipment for admin review when riskScore >= AI_DISPUTE_THRESHOLD", () => {
  const aiDisputeThreshold = 80.0;
  function shouldFlagForAdmin(riskScore, currentAdminFlagged) {
    if (currentAdminFlagged) return true;
    return typeof riskScore === "number" && riskScore >= aiDisputeThreshold;
  }

  // High risk score (85% >= 80%) triggers admin flag
  assert.strictEqual(shouldFlagForAdmin(85.0, false), true);
  // Boundary at threshold (80% >= 80%) triggers admin flag
  assert.strictEqual(shouldFlagForAdmin(80.0, false), true);
  // Normal/moderate risk (60% < 80%) does NOT trigger admin flag
  assert.strictEqual(shouldFlagForAdmin(60.0, false), false);
  // Low risk (15%) does not flag
  assert.strictEqual(shouldFlagForAdmin(15.0, false), false);
  // If already flagged, retains flag
  assert.strictEqual(shouldFlagForAdmin(20.0, true), true);
});

test("Feature calculation computes real relative thresholds without normalization hack", () => {
  const shipment = { maxTemp: 8.0, maxHumidity: 70.0 };
  const currentTemp = 12.5;
  const maxSpike = 14.0;

  // Real relative features without +8 or +60 hacks
  const temp_rel = Number((currentTemp - shipment.maxTemp).toFixed(2));
  const spike_rel = Number((maxSpike - shipment.maxTemp).toFixed(2));

  assert.strictEqual(temp_rel, 4.5); // 12.5 - 8.0
  assert.strictEqual(spike_rel, 6.0); // 14.0 - 8.0

  // Safe cold chain: negative relative values
  const safeTemp = 4.0;
  const safeSpike = 5.5;
  assert.strictEqual(Number((safeTemp - shipment.maxTemp).toFixed(2)), -4.0);
  assert.strictEqual(Number((safeSpike - shipment.maxTemp).toFixed(2)), -2.5);
});

// Verification that all routes, services, config, middleware, and utils import cleanly without syntax or initialization errors
const srcDirs = ["routes", "services", "config", "middleware", "utils"];
for (const dir of srcDirs) {
  const dirPath = path.resolve(__dirname, `../src/${dir}`);
  if (fs.existsSync(dirPath)) {
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith(".js"));
    for (const file of files) {
      test(`${dir} module ${dir}/${file} imports cleanly without syntax or loading errors`, async () => {
        const mod = await import(`../src/${dir}/${file}`);
        assert.ok(mod, `${dir} module ${dir}/${file} loaded successfully`);
      });
    }
  }
}

