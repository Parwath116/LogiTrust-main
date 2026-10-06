import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { releaseEscrowOnChain, disputeEscrowOnChain, updateShipmentStatusOnChain } from "../services/blockchain.js";
import { sendDisputeEmail, sendDeliveryEmail } from "../services/emailService.js";

const prisma = new PrismaClient();
const router = Router();

router.post("/:shipmentCode/approve", requireAuth, requireRole("RECEIVER", "ADMIN"), async (req, res) => {
  const { shipmentCode } = req.params;
  try {
    const shipment = await prisma.shipment.findUnique({ where: { shipmentCode } });
    if (!shipment) return res.status(404).json({ error: "Shipment not found" });
    if (shipment.status === "DELIVERED" || shipment.status === "DISPUTED" || shipment.status === "RESOLVED" || shipment.status === "REFUNDED") return res.status(400).json({ error: "Shipment is already resolved" });

    // Require arrival for RECEIVER (ADMIN may override)
    if (req.auth.role === "RECEIVER" && !shipment.arrivedAt) {
      return res.status(400).json({
        error: "Shipment has not arrived at destination yet (geo-fence arrival verification required)"
      });
    }

    let txHash = null;
    if (process.env.SMART_ESCROW_ADDRESS && process.env.DEPLOYER_PRIVATE_KEY) {
      txHash = await releaseEscrowOnChain(shipmentCode);
    }
    if (process.env.SHIPMENT_REGISTRY_ADDRESS && process.env.DEPLOYER_PRIVATE_KEY) {
      try {
        await updateShipmentStatusOnChain(shipmentCode, "DELIVERED");
      } catch (e) {
        console.warn(`[Blockchain] Failed to update registry status for ${shipmentCode}:`, e.message);
      }
    }
    await prisma.shipment.update({
      where: { shipmentCode },
      data: { status: "DELIVERED", ...(txHash ? { onChainTxHash: txHash } : {}) },
    });
    
    // Trigger delivery notification
    sendDeliveryEmail(shipment);
    
    res.json({ status: "released", txHash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:shipmentCode/dispute", requireAuth, requireRole("RECEIVER", "ADMIN"), async (req, res) => {
  const { shipmentCode } = req.params;
  try {
    const shipment = await prisma.shipment.findUnique({ where: { shipmentCode } });
    if (!shipment) return res.status(404).json({ error: "Shipment not found" });
    if (req.auth.role === "RECEIVER" && shipment.receiverId !== req.auth.userId) return res.status(403).json({ error: "Not authorized to dispute this shipment" });
    if (shipment.status === "DELIVERED" || shipment.status === "DISPUTED" || shipment.status === "RESOLVED" || shipment.status === "REFUNDED") return res.status(400).json({ error: "Shipment is already resolved" });

    let txHash = null;
    if (process.env.SMART_ESCROW_ADDRESS && process.env.DEPLOYER_PRIVATE_KEY) {
      txHash = await disputeEscrowOnChain(shipmentCode);
    }
    if (process.env.SHIPMENT_REGISTRY_ADDRESS && process.env.DEPLOYER_PRIVATE_KEY) {
      try {
        await updateShipmentStatusOnChain(shipmentCode, "DISPUTED");
      } catch (e) {
        console.warn(`[Blockchain] Failed to update registry status for ${shipmentCode}:`, e.message);
      }
    }
    await prisma.shipment.update({
      where: { shipmentCode },
      data: { status: "DISPUTED", ...(txHash ? { onChainTxHash: txHash } : {}) },
    });
    
    // Trigger dispute notification
    sendDisputeEmail(shipment, "Receiver manually rejected the shipment.");
    
    res.json({ status: "disputed", txHash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
