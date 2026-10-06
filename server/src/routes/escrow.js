import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { releaseEscrowOnChain, disputeEscrowOnChain } from "../services/blockchain.js";
import { sendDisputeEmail, sendDeliveryEmail } from "../services/emailService.js";

const prisma = new PrismaClient();
const router = Router();

router.post("/:shipmentCode/approve", requireAuth, requireRole("RECEIVER", "ADMIN"), async (req, res) => {
  const { shipmentCode } = req.params;
  try {
    const shipment = await prisma.shipment.findUnique({ where: { shipmentCode } });
    if (!shipment) return res.status(404).json({ error: "Shipment not found" });
    if (req.auth.role === "RECEIVER" && shipment.receiverId !== req.auth.userId) return res.status(403).json({ error: "Not authorized to approve this shipment" });
    if (shipment.status === "DELIVERED" || shipment.status === "DISPUTED") return res.status(400).json({ error: "Shipment is already resolved" });

    const txHash = await releaseEscrowOnChain(shipmentCode);
    await prisma.shipment.update({
      where: { shipmentCode },
      data: { status: "DELIVERED", onChainTxHash: txHash },
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
    if (shipment.status === "DELIVERED" || shipment.status === "DISPUTED") return res.status(400).json({ error: "Shipment is already resolved" });

    const txHash = await disputeEscrowOnChain(shipmentCode);
    await prisma.shipment.update({
      where: { shipmentCode },
      data: { status: "DISPUTED", onChainTxHash: txHash },
    });
    
    // Trigger dispute notification
    sendDisputeEmail(shipment, "Receiver manually rejected the shipment.");
    
    res.json({ status: "disputed", txHash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
