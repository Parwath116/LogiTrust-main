import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { registerShipmentOnChain } from "../services/blockchain.js";
import { resolveCityCoordinates } from "../utils/geo.js";
import { z } from "zod";

const prisma = new PrismaClient();
const router = Router();

const createShipmentSchema = z.object({
  item: z.string().min(1).regex(/^[^<>]*$/, "HTML tags are not allowed (XSS prevention)"),
  origin: z.string().min(1).regex(/^[^<>]*$/, "HTML tags are not allowed (XSS prevention)"),
  destination: z.string().min(1).regex(/^[^<>]*$/, "HTML tags are not allowed (XSS prevention)"),
  maxTemp: z.number(),
  maxHumidity: z.number(),
  escrowValue: z.number().gt(0, "Escrow value must be strictly greater than 0"),
  receiverEmail: z.string().email().optional().or(z.literal("")),
  assignedSensorId: z.string().optional().or(z.literal("")),
  destLat: z.number().optional().nullable(),
  destLon: z.number().optional().nullable(),
});

// List shipments — Admin sees all, Shipper sees own, Receiver sees own
router.get("/", requireAuth, async (req, res) => {
  const { userId, role } = req.auth;
  let where = {};
  if (role === "SHIPPER") where = { shipperId: userId };
  if (role === "RECEIVER") where = { receiverId: userId };

  const shipments = await prisma.shipment.findMany({
    where,
    include: { readings: { orderBy: { timestamp: "desc" }, take: 1 } },
    orderBy: { createdAt: "desc" },
  });
  res.json(shipments);
});

// Register a new shipment — Shipper or Admin only
router.post("/", requireAuth, requireRole("SHIPPER", "ADMIN"), async (req, res) => {
  try {
    const validated = createShipmentSchema.parse(req.body);
    const { item, origin, destination, maxTemp, maxHumidity, escrowValue, receiverEmail, assignedSensorId } = validated;

    const receiver = receiverEmail
      ? await prisma.user.findUnique({ where: { email: receiverEmail } })
      : null;

    const destCoords = await resolveCityCoordinates(destination, validated.destLat, validated.destLon);
    if (!destCoords && (validated.destLat == null || validated.destLon == null)) {
      return res.status(400).json({
        error: `Could not resolve destination coordinates for "${destination}". Please specify custom destLat and destLon.`
      });
    }

    const finalDestLat = destCoords?.lat ?? validated.destLat;
    const finalDestLon = destCoords?.lon ?? validated.destLon;

    let shipment;
    let attempts = 0;
    while (attempts < 3) {
      try {
        const shipmentCode = `SHP-${Math.floor(100000 + Math.random() * 900000)}`; // 6 digits
        shipment = await prisma.shipment.create({
          data: {
            shipmentCode,
            item,
            origin,
            destination,
            destLat: finalDestLat,
            destLon: finalDestLon,
            maxTemp,
            maxHumidity,
            escrowValue,
            assignedSensorId,
            shipperId: req.auth.userId,
            receiverId: receiver?.id,
            receiverEmail: receiverEmail || null,
          },
        });
        break; // Success
      } catch (e) {
        if (e.code === 'P2002') { // Prisma unique constraint violation
          attempts++;
          if (attempts >= 3) throw new Error("Failed to generate unique shipment code");
        } else {
          throw e;
        }
      }
    }

    // Write the shipment onto the Sepolia registry contract
    if (!process.env.SHIPMENT_REGISTRY_ADDRESS || !process.env.DEPLOYER_PRIVATE_KEY) {
      console.info(`[Blockchain] Contracts not configured; shipment ${shipment.shipmentCode} marked NOT_REGISTERED`);
      shipment.onChainStatus = "NOT_REGISTERED";
    } else {
      try {
        const txHash = await registerShipmentOnChain(shipment);
        await prisma.shipment.update({
          where: { id: shipment.id },
          data: { onChainTxHash: txHash, onChainStatus: "REGISTERED" },
        });
        shipment.onChainTxHash = txHash;
        shipment.onChainStatus = "REGISTERED";
      } catch (err) {
        console.error(`[Blockchain] On-chain registration failed for ${shipment.shipmentCode}:`, err.message);
        await prisma.shipment.update({
          where: { id: shipment.id },
          data: { onChainStatus: "FAILED" },
        });
        shipment.onChainStatus = "FAILED";
      }
    }

    res.status(201).json(shipment);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    res.status(500).json({ error: err.message });
  }
});

// Shipper flags a shipment as delayed
router.post("/:id/flag-delay", requireAuth, requireRole("SHIPPER"), async (req, res) => {
  try {
    const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
    if (!shipment) return res.status(404).json({ error: "Shipment not found" });
    if (shipment.shipperId !== req.auth.userId) return res.status(403).json({ error: "Not your shipment" });

    await prisma.shipment.update({
      where: { id: req.params.id },
      data: { adminFlagged: true }
    });

    res.json({ message: "Shipment flagged for admin review." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin resolves a flagged or disputed shipment
router.post("/:id/admin-resolve", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const { action } = req.body; // "REFUND_RECEIVER" or "RELEASE_FUNDS"
    if (action !== "REFUND_RECEIVER" && action !== "RELEASE_FUNDS") {
      return res.status(400).json({ error: "Invalid action. Must be REFUND_RECEIVER or RELEASE_FUNDS" });
    }

    const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
    if (!shipment) return res.status(404).json({ error: "Shipment not found" });

    // Reject already resolved shipments
    if (shipment.status === "DELIVERED" || shipment.status === "RESOLVED" || shipment.status === "REFUNDED") {
      return res.status(400).json({ error: "Shipment is already resolved" });
    }

    // Must be DISPUTED or adminFlagged to be resolved by admin
    if (shipment.status !== "DISPUTED" && !shipment.adminFlagged) {
      return res.status(400).json({ error: "Shipment must be disputed or flagged for review to be resolved" });
    }

    const releaseToShipper = action === "RELEASE_FUNDS";
    let txHash = null;

    // Call on-chain resolution if blockchain contracts are configured
    if (process.env.SMART_ESCROW_ADDRESS && process.env.DEPLOYER_PRIVATE_KEY) {
      try {
        const { resolveDisputeOnChain } = await import("../services/blockchain.js");
        txHash = await resolveDisputeOnChain(shipment.shipmentCode, releaseToShipper);
      } catch (err) {
        console.error(`[Blockchain] On-chain dispute resolution failed for ${shipment.shipmentCode}:`, err.message);
        // Do NOT update DB status if on-chain call fails
        return res.status(500).json({ error: `On-chain dispute resolution failed: ${err.message}` });
      }
    }

    const newStatus = action === "REFUND_RECEIVER" ? "REFUNDED" : "RESOLVED";

    if (process.env.SHIPMENT_REGISTRY_ADDRESS && process.env.DEPLOYER_PRIVATE_KEY) {
      try {
        const { updateShipmentStatusOnChain } = await import("../services/blockchain.js");
        await updateShipmentStatusOnChain(shipment.shipmentCode, newStatus);
      } catch (err) {
        console.warn(`[Blockchain] Failed to update registry status on-chain for ${shipment.shipmentCode}:`, err.message);
      }
    }

    await prisma.shipment.update({
      where: { id: req.params.id },
      data: {
        status: newStatus,
        adminFlagged: false,
        ...(txHash ? { onChainTxHash: txHash } : {}),
      },
    });

    if (action === "REFUND_RECEIVER") {
      // Notify receiver via DB and email
      if (shipment.receiverId) {
        await prisma.notification.create({
          data: {
            userId: shipment.receiverId,
            message: `Admin has manually revoked contract for ${shipment.shipmentCode}. Refund issued.`,
          },
        });
      }
      const { sendDisputeEmail } = await import("../services/emailService.js");
      sendDisputeEmail(shipment, "Admin manually refunded the shipment.");
    } else {
      // Notify shipper via DB and email
      await prisma.notification.create({
        data: {
          userId: shipment.shipperId,
          message: `Admin has manually released funds for ${shipment.shipmentCode}.`,
        },
      });
      const { sendDeliveryEmail } = await import("../services/emailService.js");
      sendDeliveryEmail(shipment);
    }

    res.json({ message: "Shipment resolved successfully.", status: newStatus, txHash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
