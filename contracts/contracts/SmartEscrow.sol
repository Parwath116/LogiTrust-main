// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract SmartEscrow {
    enum EscrowState { Locked, Released, Disputed, Refunded }

    struct Escrow {
        address shipper;
        address receiver;
        uint256 amount;
        bool geoFenceVerified;
        bool temperatureOk;
        bool payloadVerified;
        EscrowState state;
    }

    mapping(bytes32 => Escrow) public escrows;
    address public admin;
    mapping(address => bool) public authorizedOracles;

    event EscrowLocked(bytes32 indexed shipmentId, uint256 amount);
    event EscrowReleased(bytes32 indexed shipmentId, uint256 amount);
    event EscrowDisputed(bytes32 indexed shipmentId);
    event EscrowRefunded(bytes32 indexed shipmentId, uint256 amount);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    modifier onlyOracle() {
        require(authorizedOracles[msg.sender], "Not an authorized oracle");
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    function setOracle(address oracle, bool allowed) external onlyAdmin {
        authorizedOracles[oracle] = allowed;
    }

    function lockEscrow(bytes32 shipmentId, address shipper, address receiver) external payable {
        require(shipper != address(0), "Invalid shipper address");
        require(receiver != address(0), "Invalid receiver address");
        require(msg.value > 0, "Escrow amount must be greater than zero");
        require(escrows[shipmentId].amount == 0, "Escrow already exists");

        escrows[shipmentId] = Escrow({
            shipper: shipper,
            receiver: receiver,
            amount: msg.value,
            geoFenceVerified: false,
            temperatureOk: true,
            payloadVerified: false,
            state: EscrowState.Locked
        });
        emit EscrowLocked(shipmentId, msg.value);
    }

    function markGeoFence(bytes32 shipmentId) external onlyOracle {
        require(escrows[shipmentId].amount > 0, "Escrow does not exist");
        escrows[shipmentId].geoFenceVerified = true;
        _tryAutoRelease(shipmentId);
    }

    function markPayloadVerified(bytes32 shipmentId) external onlyOracle {
        require(escrows[shipmentId].amount > 0, "Escrow does not exist");
        escrows[shipmentId].payloadVerified = true;
        _tryAutoRelease(shipmentId);
    }

    function flagTemperatureBreach(bytes32 shipmentId) external onlyOracle {
        require(escrows[shipmentId].amount > 0, "Escrow does not exist");
        escrows[shipmentId].temperatureOk = false;
    }

    function _tryAutoRelease(bytes32 shipmentId) internal {
        Escrow storage e = escrows[shipmentId];
        if (e.state == EscrowState.Locked && e.geoFenceVerified && e.temperatureOk && e.payloadVerified) {
            _release(shipmentId);
        }
    }

    function releaseEscrow(bytes32 shipmentId) external {
        Escrow storage e = escrows[shipmentId];
        require(e.amount > 0, "Escrow does not exist");
        require(msg.sender == e.receiver || msg.sender == admin, "Not authorized");
        require(e.state == EscrowState.Locked, "Not locked");
        _release(shipmentId);
    }

    function _release(bytes32 shipmentId) internal {
        Escrow storage e = escrows[shipmentId];
        e.state = EscrowState.Released;
        (bool sent, ) = e.shipper.call{value: e.amount}("");
        require(sent, "Transfer failed");
        emit EscrowReleased(shipmentId, e.amount);
    }

    function disputeEscrow(bytes32 shipmentId) external {
        Escrow storage e = escrows[shipmentId];
        require(e.amount > 0, "Escrow does not exist");
        require(msg.sender == e.receiver || msg.sender == admin, "Not authorized");
        require(e.state == EscrowState.Locked, "Escrow not locked");
        e.state = EscrowState.Disputed;
        emit EscrowDisputed(shipmentId);
    }

    // Admin resolves a dispute manually — simplified arbitration for Phase 1/2.
    function resolveDispute(bytes32 shipmentId, bool releaseToShipper) external onlyAdmin {
        Escrow storage e = escrows[shipmentId];
        require(e.amount > 0, "Escrow does not exist");
        require(e.state == EscrowState.Disputed, "Not disputed");
        if (releaseToShipper) {
            _release(shipmentId);
        } else {
            e.state = EscrowState.Refunded;
            (bool sent, ) = e.receiver.call{value: e.amount}("");
            require(sent, "Refund failed");
            emit EscrowRefunded(shipmentId, e.amount);
        }
    }
}
