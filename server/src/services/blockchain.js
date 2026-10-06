import { ethers } from "ethers";
import registryAbi from "../../abi/ShipmentRegistry.json" with { type: "json" };
import escrowAbi from "../../abi/SmartEscrow.json" with { type: "json" };

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
  const tx = await contract.registerShipment(
    ethers.encodeBytes32String(shipment.shipmentCode),
    shipment.origin,
    shipment.destination,
    "general",
    Math.round(shipment.maxTemp),
    Math.round(shipment.maxHumidity),
    ethers.parseEther(String(shipment.escrowValue))
  );
  const receipt = await tx.wait();
  
  // Deposit funds into Smart Escrow
  const escrowContract = getEscrowContract();
  const signerAddress = await getSigner().getAddress();
  const escrowTx = await escrowContract.lockEscrow(
    ethers.encodeBytes32String(shipment.shipmentCode),
    signerAddress, // Shipper address
    signerAddress, // Receiver address
    { value: ethers.parseEther(String(shipment.escrowValue)) }
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
  await tx.wait();
  
  // Dispute escrow and refund receiver
  const resolveTx = await contract.resolveDispute(ethers.encodeBytes32String(shipmentCode), false);
  const receipt = await resolveTx.wait();
  
  return receipt.hash;
}
