import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { registerShipmentOnChain } from "../services/blockchain.js";
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

    // Write the shipment onto the Sepolia registry contract (no-op if contract not configured yet)
    try {
      const txHash = await registerShipmentOnChain(shipment);
      await prisma.shipment.update({ where: { id: shipment.id }, data: { onChainTxHash: txHash } });
      shipment.onChainTxHash = txHash;
    } catch (err) {
      console.warn("On-chain registration skipped:", err.message);
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
    const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
    if (!shipment) return res.status(404).json({ error: "Shipment not found" });
    if (shipment.status === "DELIVERED" || shipment.status === "DISPUTED") return res.status(400).json({ error: "Shipment is already resolved" });

    if (action === "REFUND_RECEIVER") {
      // Call blockhain dispute
      const { disputeEscrowOnChain } = await import("../services/blockchain.js");
      try {
        await disputeEscrowOnChain(shipment.shipmentCode);
      } catch (err) {
         console.warn("On-chain dispute failed:", err.message);
      }
      await prisma.shipment.update({
        where: { id: req.params.id },
        data: { status: "DISPUTED", adminFlagged: false }
      });
      // Notify receiver via DB and email
      if (shipment.receiverId || shipment.receiverEmail) {
        if (shipment.receiverId) {
          await prisma.notification.create({
            data: {
              userId: shipment.receiverId,
              message: `Admin has manually revoked contract for ${shipment.shipmentCode}. Refund issued.`,
            }
          });
        }
        
        // Trigger dispute notification
        const { sendDisputeEmail } = await import("../services/emailService.js");
        sendDisputeEmail(shipment, "Admin manually refunded the shipment.");
      }
    } else if (action === "RELEASE_FUNDS") {
      // Call blockchain release
      const { releaseEscrowOnChain } = await import("../services/blockchain.js");
      try {
        await releaseEscrowOnChain(shipment.shipmentCode);
      } catch (err) {
         console.warn("On-chain release failed:", err.message);
      }
      await prisma.shipment.update({
        where: { id: req.params.id },
        data: { status: "DELIVERED", adminFlagged: false }
      });
      // Notify shipper
      await prisma.notification.create({
        data: {
          userId: shipment.shipperId,
          message: `Admin has manually released funds for ${shipment.shipmentCode}.`,
        }
      });
      
      const { sendDeliveryEmail } = await import("../services/emailService.js");
      sendDeliveryEmail(shipment);
    } else {
      return res.status(400).json({ error: "Invalid action" });
    }

    res.json({ message: "Shipment resolved successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
