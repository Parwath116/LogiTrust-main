import nodemailer from "nodemailer";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Configure the Gmail SMTP transporter using credentials from .env
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // Application-specific password required
  },
});

export async function sendDisputeEmail(shipment, reason = "Manual Dispute") {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn("⚠️ Cannot send real email: EMAIL_USER or EMAIL_PASS is missing in .env");
    return;
  }

  try {
    // Look up Shipper's email
    const shipper = await prisma.user.findUnique({ where: { id: shipment.shipperId } });
    const shipperEmail = shipper?.email;
    const receiverEmail = shipment.receiverEmail;

    const recipients = [];
    if (shipperEmail) recipients.push(shipperEmail);
    if (receiverEmail) recipients.push(receiverEmail);

    if (recipients.length === 0) {
      console.warn("⚠️ No emails on file to send dispute notification to.");
      return;
    }

    const mailOptions = {
      from: `"LogiTrust Oracle" <${process.env.EMAIL_USER}>`,
      to: recipients.join(", "),
      subject: `LogiTrust Escrow Disputed [${shipment.shipmentCode}]`,
      text: `Dear Parties,

Be advised that the smart contract escrow for shipment ${shipment.shipmentCode} has been officially DISPUTED and REVOKED.

Reason for Revocation: ${reason}

Actions Taken:
- The locked escrow amount of ₹${shipment.escrowValue} is being refunded to the Receiver.
- The shipment status is now permanently marked as DISPUTED on the blockchain.

Please check your Metamask wallet (Sepolia Network) to confirm the refund transaction.

Regards,
LogiTrust System`,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`📧 Dispute notification sent to ${recipients.join(", ")} | MessageId: ${info.messageId}`);
  } catch (error) {
    console.error("❌ Failed to send real email via Gmail:", error);
  }
}

export async function sendDeliveryEmail(shipment) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn("⚠️ Cannot send real email: EMAIL_USER or EMAIL_PASS is missing in .env");
    return;
  }

  try {
    const shipper = await prisma.user.findUnique({ where: { id: shipment.shipperId } });
    const shipperEmail = shipper?.email;
    const receiverEmail = shipment.receiverEmail;

    const recipients = [];
    if (shipperEmail) recipients.push(shipperEmail);
    if (receiverEmail) recipients.push(receiverEmail);

    if (recipients.length === 0) {
      console.warn("⚠️ No emails on file to send delivery notification to.");
      return;
    }

    const mailOptions = {
      from: `"LogiTrust Oracle" <${process.env.EMAIL_USER}>`,
      to: recipients.join(", "),
      subject: `✅ LogiTrust Escrow Released [${shipment.shipmentCode}]`,
      text: `Dear Parties,

We are pleased to inform you that the shipment ${shipment.shipmentCode} has been successfully DELIVERED and the escrow funds have been RELEASED.

Actions Taken:
- The locked escrow amount of ₹${shipment.escrowValue} has been released and transferred to the Shipper.
- The shipment status is now permanently marked as DELIVERED on the blockchain.

Please check your Metamask wallet (Sepolia Network) to confirm the transaction.

Thank you for using LogiTrust!

Regards,
LogiTrust System`,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`📧 Delivery notification sent to ${recipients.join(", ")} | MessageId: ${info.messageId}`);
  } catch (error) {
    console.error("❌ Failed to send delivery email via Gmail:", error);
  }
}
