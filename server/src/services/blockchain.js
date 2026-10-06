import { ethers } from "ethers";
import registryAbi from "../../abi/ShipmentRegistry.json" with { type: "json" };
import escrowAbi from "../../abi/SmartEscrow.json" with { type: "json" };

export function inrToEth(inrAmount) {
  if (process.env.TEST_ETH_SCALE) {
    const scale = parseFloat(process.env.TEST_ETH_SCALE);
    return Number((Number(inrAmount) * scale).toFixed(8)).toString();
  }
  const inrPerEth = parseFloat(process.env.INR_PER_ETH || "250000");
  const eth = Number(inrAmount) / inrPerEth;
  return Number(eth.toFixed(8)).toString();
}

function getProvider() {
  if (!process.env.SEPOLIA_RPC_URL) throw new Error("SEPOLIA_RPC_URL not set");
  return new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
}

function getSigner() {
  const provider = getProvider();
  if (!process.env.DEPLOYER_PRIVATE_KEY) throw new Error("DEPLOYER_PRIVATE_KEY not set");
  return new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
}

function getRegistryContract() {
  if (!process.env.SHIPMENT_REGISTRY_ADDRESS) throw new Error("Registry contract not deployed yet");
  return new ethers.Contract(process.env.SHIPMENT_REGISTRY_ADDRESS, registryAbi, getSigner());
}

function getEscrowContract() {
  if (!process.env.SMART_ESCROW_ADDRESS) throw new Error("Escrow contract not deployed yet");
  return new ethers.Contract(process.env.SMART_ESCROW_ADDRESS, escrowAbi, getSigner());
}

export async function registerShipmentOnChain(shipment) {
  const contract = getRegistryContract();
  const ethAmount = inrToEth(shipment.escrowValue);
  const ethWei = ethers.parseEther(ethAmount);

  const tx = await contract.registerShipment(
    ethers.encodeBytes32String(shipment.shipmentCode),
    shipment.origin,
    shipment.destination,
    "general",
    Math.round(shipment.maxTemp),
    Math.round(shipment.maxHumidity),
    ethWei
  );
  const receipt = await tx.wait();
  
  // Deposit funds into Smart Escrow
  const escrowContract = getEscrowContract();
  const signerAddress = await getSigner().getAddress();
  const escrowTx = await escrowContract.lockEscrow(
    ethers.encodeBytes32String(shipment.shipmentCode),
    signerAddress, // Shipper address
    signerAddress, // Receiver address
    { value: ethWei }
  );
  await escrowTx.wait();

  return receipt.hash;
}

export async function releaseEscrowOnChain(shipmentCode) {
  const contract = getEscrowContract();
  const tx = await contract.releaseEscrow(ethers.encodeBytes32String(shipmentCode));
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function disputeEscrowOnChain(shipmentCode) {
  const contract = getEscrowContract();
  const tx = await contract.disputeEscrow(ethers.encodeBytes32String(shipmentCode));
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function resolveDisputeOnChain(shipmentCode, releaseToShipper) {
  const contract = getEscrowContract();
  const shipmentBytes = ethers.encodeBytes32String(shipmentCode);

  // EscrowState: Locked (0), Released (1), Disputed (2)
  const escrowData = await contract.escrows(shipmentBytes);
  const state = Number(escrowData.state);

  if (state === 0) { // If still Locked on-chain (e.g. shipper flagged delay)
    if (releaseToShipper) {
      const tx = await contract.releaseEscrow(shipmentBytes);
      const receipt = await tx.wait();
      return receipt.hash;
    } else {
      // Must be marked Disputed before resolving refund
      const dispTx = await contract.disputeEscrow(shipmentBytes);
      await dispTx.wait();
    }
  }

  const tx = await contract.resolveDispute(shipmentBytes, Boolean(releaseToShipper));
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function markGeoFenceOnChain(shipmentCode) {
  const contract = getEscrowContract();
  const tx = await contract.markGeoFence(ethers.encodeBytes32String(shipmentCode));
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function flagTemperatureBreachOnChain(shipmentCode) {
  const contract = getEscrowContract();
  const tx = await contract.flagTemperatureBreach(ethers.encodeBytes32String(shipmentCode));
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function updateShipmentStatusOnChain(shipmentCode, statusStr) {
  const contract = getRegistryContract();
  // ShipmentRegistry.sol: enum Status { Pending, InTransit, Delivered, Disputed }
  const statusMap = {
    PENDING: 0,
    IN_TRANSIT: 1,
    DELIVERED: 2,
    RESOLVED: 2,
    DISPUTED: 3,
    REFUNDED: 3,
  };
  const statusNum = statusMap[String(statusStr).toUpperCase()] ?? 0;
  const tx = await contract.updateStatus(ethers.encodeBytes32String(shipmentCode), statusNum);
  const receipt = await tx.wait();
  return receipt.hash;
}
