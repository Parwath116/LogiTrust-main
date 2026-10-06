const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  console.log("Deploying contracts with account:", deployerAddress);

  const Registry = await hre.ethers.getContractFactory("ShipmentRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  console.log("ShipmentRegistry deployed to:", await registry.getAddress());

  const Escrow = await hre.ethers.getContractFactory("SmartEscrow");
  const escrow = await Escrow.deploy();
  await escrow.waitForDeployment();
  console.log("SmartEscrow deployed to:", await escrow.getAddress());

  // Grant deployer/backend wallet oracle authorization on both contracts
  const tx1 = await registry.setOracle(deployerAddress, true);
  await tx1.wait();
  console.log("Granted oracle role to backend wallet on ShipmentRegistry:", deployerAddress);

  const tx2 = await escrow.setOracle(deployerAddress, true);
  await tx2.wait();
  console.log("Granted oracle role to backend wallet on SmartEscrow:", deployerAddress);

  // Copy ABIs into the server so it can call the contracts
  const abiDir = path.join(__dirname, "../../server/abi");
  fs.mkdirSync(abiDir, { recursive: true });

  const registryArtifact = await hre.artifacts.readArtifact("ShipmentRegistry");
  const escrowArtifact = await hre.artifacts.readArtifact("SmartEscrow");
  fs.writeFileSync(path.join(abiDir, "ShipmentRegistry.json"), JSON.stringify(registryArtifact.abi, null, 2));
  fs.writeFileSync(path.join(abiDir, "SmartEscrow.json"), JSON.stringify(escrowArtifact.abi, null, 2));

  console.log("\nAdd these to server/.env:");
  console.log("SHIPMENT_REGISTRY_ADDRESS=" + (await registry.getAddress()));
  console.log("SMART_ESCROW_ADDRESS=" + (await escrow.getAddress()));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
