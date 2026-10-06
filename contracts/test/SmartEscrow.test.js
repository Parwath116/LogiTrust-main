const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SmartEscrow", function () {
  let smartEscrow;
  let admin;
  let shipper;
  let receiver;
  let oracle;
  let stranger;
  const shipmentId = ethers.encodeBytes32String("SHP-9999");
  const unregShipmentId = ethers.encodeBytes32String("SHP-NONEXIST");
  const escrowAmount = ethers.parseEther("1.0"); // 1 ETH

  beforeEach(async function () {
    [admin, shipper, receiver, oracle, stranger] = await ethers.getSigners();

    const SmartEscrow = await ethers.getContractFactory("SmartEscrow");
    smartEscrow = await SmartEscrow.deploy();
    await smartEscrow.waitForDeployment();

    // Authorize oracle
    await smartEscrow.setOracle(oracle.address, true);
  });

  describe("Escrow Creation & Validation", function () {
    it("should allow locking escrow with valid parameters", async function () {
      await expect(
        smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: escrowAmount })
      ).to.emit(smartEscrow, "EscrowLocked").withArgs(shipmentId, escrowAmount);

      const e = await smartEscrow.escrows(shipmentId);
      expect(e.shipper).to.equal(shipper.address);
      expect(e.receiver).to.equal(receiver.address);
      expect(e.amount).to.equal(escrowAmount);
      expect(e.state).to.equal(0); // EscrowState.Locked
      expect(e.temperatureOk).to.equal(true);
      expect(e.geoFenceVerified).to.equal(false);
      expect(e.payloadVerified).to.equal(false);
    });

    it("should reject locking with zero shipper address", async function () {
      await expect(
        smartEscrow.lockEscrow(shipmentId, ethers.ZeroAddress, receiver.address, { value: escrowAmount })
      ).to.be.revertedWith("Invalid shipper address");
    });

    it("should reject locking with zero receiver address", async function () {
      await expect(
        smartEscrow.lockEscrow(shipmentId, shipper.address, ethers.ZeroAddress, { value: escrowAmount })
      ).to.be.revertedWith("Invalid receiver address");
    });

    it("should reject locking with zero value", async function () {
      await expect(
        smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: 0 })
      ).to.be.revertedWith("Escrow amount must be greater than zero");
    });

    it("should reject locking an already existing escrow", async function () {
      await smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: escrowAmount });
      await expect(
        smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: escrowAmount })
      ).to.be.revertedWith("Escrow already exists");
    });
  });

  describe("Release Escrow", function () {
    it("should revert if escrow does not exist", async function () {
      await expect(
        smartEscrow.connect(receiver).releaseEscrow(unregShipmentId)
      ).to.be.revertedWith("Escrow does not exist");
    });

    it("should revert if caller is unauthorized", async function () {
      await smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: escrowAmount });
      await expect(
        smartEscrow.connect(stranger).releaseEscrow(shipmentId)
      ).to.be.revertedWith("Not authorized");
    });

    it("should allow receiver to release and transfer funds to shipper", async function () {
      await smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: escrowAmount });

      const initialShipperBal = await ethers.provider.getBalance(shipper.address);
      await expect(
        smartEscrow.connect(receiver).releaseEscrow(shipmentId)
      ).to.emit(smartEscrow, "EscrowReleased").withArgs(shipmentId, escrowAmount);

      const finalShipperBal = await ethers.provider.getBalance(shipper.address);
      expect(finalShipperBal - initialShipperBal).to.equal(escrowAmount);

      const e = await smartEscrow.escrows(shipmentId);
      expect(e.state).to.equal(1); // Released
    });

    it("should allow admin to release escrow", async function () {
      await smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: escrowAmount });

      const initialShipperBal = await ethers.provider.getBalance(shipper.address);
      await expect(
        smartEscrow.connect(admin).releaseEscrow(shipmentId)
      ).to.emit(smartEscrow, "EscrowReleased").withArgs(shipmentId, escrowAmount);

      const finalShipperBal = await ethers.provider.getBalance(shipper.address);
      expect(finalShipperBal - initialShipperBal).to.equal(escrowAmount);
    });

    it("should revert if escrow is not in Locked state", async function () {
      await smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: escrowAmount });
      await smartEscrow.connect(receiver).releaseEscrow(shipmentId);

      await expect(
        smartEscrow.connect(receiver).releaseEscrow(shipmentId)
      ).to.be.revertedWith("Not locked");
    });
  });

  describe("Dispute Escrow & Vulnerability Prevention (Drain Bug Fix)", function () {
    it("should revert if escrow does not exist", async function () {
      await expect(
        smartEscrow.connect(receiver).disputeEscrow(unregShipmentId)
      ).to.be.revertedWith("Escrow does not exist");
    });

    it("should revert if caller is unauthorized", async function () {
      await smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: escrowAmount });
      await expect(
        smartEscrow.connect(stranger).disputeEscrow(shipmentId)
      ).to.be.revertedWith("Not authorized");
    });

    it("should allow receiver to dispute escrow when Locked", async function () {
      await smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: escrowAmount });

      await expect(
        smartEscrow.connect(receiver).disputeEscrow(shipmentId)
      ).to.emit(smartEscrow, "EscrowDisputed").withArgs(shipmentId);

      const e = await smartEscrow.escrows(shipmentId);
      expect(e.state).to.equal(2); // Disputed
    });

    it("CRITICAL: should prevent double-payout drain attempt on Released escrow", async function () {
      // Setup: Lock escrow and legitimately release it to shipper
      await smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: escrowAmount });
      await smartEscrow.connect(receiver).releaseEscrow(shipmentId);

      const e = await smartEscrow.escrows(shipmentId);
      expect(e.state).to.equal(1); // Released

      // Attempting to dispute an already released escrow MUST revert
      await expect(
        smartEscrow.connect(receiver).disputeEscrow(shipmentId)
      ).to.be.revertedWith("Escrow not locked");
    });

    it("should prevent disputing an already Refunded escrow", async function () {
      await smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: escrowAmount });
      await smartEscrow.connect(receiver).disputeEscrow(shipmentId);
      await smartEscrow.connect(admin).resolveDispute(shipmentId, false);

      const e = await smartEscrow.escrows(shipmentId);
      expect(e.state).to.equal(3); // Refunded

      await expect(
        smartEscrow.connect(receiver).disputeEscrow(shipmentId)
      ).to.be.revertedWith("Escrow not locked");
    });
  });

  describe("Dispute Resolution (resolveDispute)", function () {
    beforeEach(async function () {
      await smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: escrowAmount });
      await smartEscrow.connect(receiver).disputeEscrow(shipmentId);
    });

    it("should revert if non-admin tries to resolve", async function () {
      await expect(
        smartEscrow.connect(stranger).resolveDispute(shipmentId, true)
      ).to.be.revertedWith("Not admin");
    });

    it("should revert if escrow does not exist", async function () {
      await expect(
        smartEscrow.connect(admin).resolveDispute(unregShipmentId, true)
      ).to.be.revertedWith("Escrow does not exist");
    });

    it("should allow admin to release to shipper and set state to Released (1)", async function () {
      const initialShipperBal = await ethers.provider.getBalance(shipper.address);

      await expect(
        smartEscrow.connect(admin).resolveDispute(shipmentId, true)
      ).to.emit(smartEscrow, "EscrowReleased").withArgs(shipmentId, escrowAmount);

      const finalShipperBal = await ethers.provider.getBalance(shipper.address);
      expect(finalShipperBal - initialShipperBal).to.equal(escrowAmount);

      const e = await smartEscrow.escrows(shipmentId);
      expect(e.state).to.equal(1); // Released
    });

    it("should allow admin to refund receiver, emit EscrowRefunded, and set state to Refunded (3)", async function () {
      const initialReceiverBal = await ethers.provider.getBalance(receiver.address);

      await expect(
        smartEscrow.connect(admin).resolveDispute(shipmentId, false)
      ).to.emit(smartEscrow, "EscrowRefunded").withArgs(shipmentId, escrowAmount);

      const finalReceiverBal = await ethers.provider.getBalance(receiver.address);
      expect(finalReceiverBal - initialReceiverBal).to.equal(escrowAmount);

      const e = await smartEscrow.escrows(shipmentId);
      expect(e.state).to.equal(3); // Refunded
    });

    it("should revert if attempting to resolve an already resolved dispute", async function () {
      await smartEscrow.connect(admin).resolveDispute(shipmentId, false);

      await expect(
        smartEscrow.connect(admin).resolveDispute(shipmentId, false)
      ).to.be.revertedWith("Not disputed");
    });
  });

  describe("Oracle Functions & Automated Escrow", function () {
    it("should revert when non-oracle calls markGeoFence", async function () {
      await smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: escrowAmount });
      await expect(
        smartEscrow.connect(stranger).markGeoFence(shipmentId)
      ).to.be.revertedWith("Not an authorized oracle");
    });

    it("should revert when non-oracle calls markPayloadVerified", async function () {
      await smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: escrowAmount });
      await expect(
        smartEscrow.connect(stranger).markPayloadVerified(shipmentId)
      ).to.be.revertedWith("Not an authorized oracle");
    });

    it("should revert when non-oracle calls flagTemperatureBreach", async function () {
      await smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: escrowAmount });
      await expect(
        smartEscrow.connect(stranger).flagTemperatureBreach(shipmentId)
      ).to.be.revertedWith("Not an authorized oracle");
    });

    it("should revert if oracle calls on nonexistent escrow", async function () {
      await expect(
        smartEscrow.connect(oracle).markGeoFence(unregShipmentId)
      ).to.be.revertedWith("Escrow does not exist");

      await expect(
        smartEscrow.connect(oracle).markPayloadVerified(unregShipmentId)
      ).to.be.revertedWith("Escrow does not exist");

      await expect(
        smartEscrow.connect(oracle).flagTemperatureBreach(unregShipmentId)
      ).to.be.revertedWith("Escrow does not exist");
    });

    it("should auto-release when all conditions are fulfilled", async function () {
      await smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: escrowAmount });

      await smartEscrow.connect(oracle).markGeoFence(shipmentId);
      const initialShipperBal = await ethers.provider.getBalance(shipper.address);

      await expect(
        smartEscrow.connect(oracle).markPayloadVerified(shipmentId)
      ).to.emit(smartEscrow, "EscrowReleased").withArgs(shipmentId, escrowAmount);

      const finalShipperBal = await ethers.provider.getBalance(shipper.address);
      expect(finalShipperBal - initialShipperBal).to.equal(escrowAmount);

      const e = await smartEscrow.escrows(shipmentId);
      expect(e.state).to.equal(1); // Released
    });

    it("should NOT auto-release if temperature breach occurred", async function () {
      await smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: escrowAmount });

      await smartEscrow.connect(oracle).flagTemperatureBreach(shipmentId);
      await smartEscrow.connect(oracle).markGeoFence(shipmentId);
      await smartEscrow.connect(oracle).markPayloadVerified(shipmentId);

      const e = await smartEscrow.escrows(shipmentId);
      expect(e.state).to.equal(0); // Still Locked
      expect(e.temperatureOk).to.equal(false);
    });
  });
});
