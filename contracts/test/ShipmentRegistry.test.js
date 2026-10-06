const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ShipmentRegistry", function () {
  let registry;
  let admin;
  let shipper;
  let oracle;
  let stranger;
  const shipmentId = ethers.encodeBytes32String("SHP-1234");
  const unregShipmentId = ethers.encodeBytes32String("SHP-9999");
  const escrowValue = ethers.parseEther("0.5");

  beforeEach(async function () {
    [admin, shipper, oracle, stranger] = await ethers.getSigners();

    const ShipmentRegistry = await ethers.getContractFactory("ShipmentRegistry");
    registry = await ShipmentRegistry.deploy();
    await registry.waitForDeployment();

    // Authorize oracle
    await registry.setOracle(oracle.address, true);
  });

  describe("Shipment Registration", function () {
    it("should allow a shipper to register a shipment", async function () {
      await expect(
        registry.connect(shipper).registerShipment(
          shipmentId,
          "Mumbai",
          "Delhi",
          "pharma",
          8,
          65,
          escrowValue
        )
      ).to.emit(registry, "ShipmentRegistered").withArgs(shipmentId, shipper.address);

      const shipment = await registry.getShipment(shipmentId);
      expect(shipment.shipmentId).to.equal(shipmentId);
      expect(shipment.origin).to.equal("Mumbai");
      expect(shipment.destination).to.equal("Delhi");
      expect(shipment.category).to.equal("pharma");
      expect(shipment.maxTemp).to.equal(8);
      expect(shipment.maxHumidity).to.equal(65);
      expect(shipment.escrowValue).to.equal(escrowValue);
      expect(shipment.shipper).to.equal(shipper.address);
      expect(shipment.status).to.equal(0); // Status.Pending
    });

    it("should reject registering a duplicate shipment ID", async function () {
      await registry.connect(shipper).registerShipment(
        shipmentId,
        "Mumbai",
        "Delhi",
        "pharma",
        8,
        65,
        escrowValue
      );

      await expect(
        registry.connect(shipper).registerShipment(
          shipmentId,
          "Mumbai",
          "Delhi",
          "pharma",
          8,
          65,
          escrowValue
        )
      ).to.be.revertedWith("Shipment already exists");
    });
  });

  describe("Status Updates & Oracle Control", function () {
    beforeEach(async function () {
      await registry.connect(shipper).registerShipment(
        shipmentId,
        "Mumbai",
        "Delhi",
        "pharma",
        8,
        65,
        escrowValue
      );
    });

    it("should allow authorized oracle to update shipment status", async function () {
      // 1 = InTransit
      await expect(
        registry.connect(oracle).updateStatus(shipmentId, 1)
      ).to.emit(registry, "StatusUpdated").withArgs(shipmentId, 1);

      const shipment = await registry.getShipment(shipmentId);
      expect(shipment.status).to.equal(1);
    });

    it("should revert if non-oracle attempts to update status", async function () {
      await expect(
        registry.connect(stranger).updateStatus(shipmentId, 1)
      ).to.be.revertedWith("Not an authorized oracle");
    });

    it("should revert updateStatus for unknown shipment", async function () {
      await expect(
        registry.connect(oracle).updateStatus(unregShipmentId, 1)
      ).to.be.revertedWith("Unknown shipment");
    });

    it("should allow authorized oracle to flag temperature breach", async function () {
      await expect(
        registry.connect(oracle).flagBreached(shipmentId, 15)
      ).to.emit(registry, "BreachFlagged").withArgs(shipmentId, 15);

      const shipment = await registry.getShipment(shipmentId);
      expect(shipment.status).to.equal(3); // Status.Disputed
    });

    it("should revert if non-oracle attempts to flag breach", async function () {
      await expect(
        registry.connect(stranger).flagBreached(shipmentId, 15)
      ).to.be.revertedWith("Not an authorized oracle");
    });
  });

  describe("Admin & Oracle Role Management", function () {
    it("should allow admin to grant and revoke oracle role", async function () {
      await registry.connect(admin).setOracle(stranger.address, true);
      expect(await registry.authorizedOracles(stranger.address)).to.equal(true);

      await registry.connect(admin).setOracle(stranger.address, false);
      expect(await registry.authorizedOracles(stranger.address)).to.equal(false);
    });

    it("should reject non-admin from modifying oracle role", async function () {
      await expect(
        registry.connect(stranger).setOracle(stranger.address, true)
      ).to.be.revertedWith("Not admin");
    });
  });
});
