const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SmartEscrow", function () {
  let smartEscrow;
  let admin;
  let shipper;
  let receiver;
  let oracle;
  const shipmentId = ethers.encodeBytes32String("SHP-9999");
  const escrowAmount = ethers.parseEther("1.0"); // 1 ETH

  beforeEach(async function () {
    [admin, shipper, receiver, oracle] = await ethers.getSigners();

    const SmartEscrow = await ethers.getContractFactory("SmartEscrow");
    smartEscrow = await SmartEscrow.deploy();
    await smartEscrow.waitForDeployment();

    // Authorize oracle
    await smartEscrow.setOracle(oracle.address, true);
  });

  it("should allow locking escrow with ETH", async function () {
    await expect(
      smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: escrowAmount })
    ).to.emit(smartEscrow, "EscrowLocked").withArgs(shipmentId, escrowAmount);

    const e = await smartEscrow.escrows(shipmentId);
    expect(e.shipper).to.equal(shipper.address);
    expect(e.receiver).to.equal(receiver.address);
    expect(e.amount).to.equal(escrowAmount);
    expect(e.state).to.equal(0); // EscrowState.Locked
  });

  it("should automatically release funds when all conditions are met", async function () {
    await smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: escrowAmount });

    await smartEscrow.connect(oracle).markGeoFence(shipmentId);
    
    const initialShipperBal = await ethers.provider.getBalance(shipper.address);

    // This should trigger _tryAutoRelease
    await expect(
      smartEscrow.connect(oracle).markPayloadVerified(shipmentId)
    ).to.emit(smartEscrow, "EscrowReleased").withArgs(shipmentId, escrowAmount);

    const finalShipperBal = await ethers.provider.getBalance(shipper.address);
    expect(finalShipperBal - initialShipperBal).to.equal(escrowAmount);

    const e = await smartEscrow.escrows(shipmentId);
    expect(e.state).to.equal(1); // EscrowState.Released
  });

  it("should allow receiver to manually release escrow", async function () {
    await smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: escrowAmount });

    const initialShipperBal = await ethers.provider.getBalance(shipper.address);

    await expect(
      smartEscrow.connect(receiver).releaseEscrow(shipmentId)
    ).to.emit(smartEscrow, "EscrowReleased").withArgs(shipmentId, escrowAmount);

    const finalShipperBal = await ethers.provider.getBalance(shipper.address);
    expect(finalShipperBal - initialShipperBal).to.equal(escrowAmount);
  });

  it("should allow receiver to dispute escrow", async function () {
    await smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: escrowAmount });

    await expect(
      smartEscrow.connect(receiver).disputeEscrow(shipmentId)
    ).to.emit(smartEscrow, "EscrowDisputed").withArgs(shipmentId);

    const e = await smartEscrow.escrows(shipmentId);
    expect(e.state).to.equal(2); // EscrowState.Disputed
  });

  it("should allow admin to resolve a dispute (refund receiver)", async function () {
    await smartEscrow.lockEscrow(shipmentId, shipper.address, receiver.address, { value: escrowAmount });
    await smartEscrow.connect(receiver).disputeEscrow(shipmentId);

    const initialReceiverBal = await ethers.provider.getBalance(receiver.address);

    // false = refund receiver
    const tx = await smartEscrow.connect(admin).resolveDispute(shipmentId, false);
    const receipt = await tx.wait();

    const finalReceiverBal = await ethers.provider.getBalance(receiver.address);
    
    expect(finalReceiverBal - initialReceiverBal).to.equal(escrowAmount);

    const e = await smartEscrow.escrows(shipmentId);
    expect(e.state).to.equal(1); // Released
  });
});
