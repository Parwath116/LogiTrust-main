// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ShipmentRegistry {
    enum Status { Pending, InTransit, Delivered, Disputed }

    struct Shipment {
        bytes32 shipmentId;
        string origin;
        string destination;
        string category;
        int8 maxTemp;
        uint8 maxHumidity;
        uint256 escrowValue;
        address receiver;
        address shipper;
        Status status;
        uint64 dispatchDate;
    }

    mapping(bytes32 => Shipment) public shipments;
    mapping(address => bool) public authorizedOracles;
    address public admin;

    event ShipmentRegistered(bytes32 indexed shipmentId, address indexed shipper);
    event StatusUpdated(bytes32 indexed shipmentId, Status status);
    event BreachFlagged(bytes32 indexed shipmentId, int256 temperature);

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

    function registerShipment(
        bytes32 shipmentId,
        string calldata origin,
        string calldata destination,
        string calldata category,
        int8 maxTemp,
        uint8 maxHumidity,
        uint256 escrowValue
    ) external {
        require(shipments[shipmentId].shipper == address(0), "Shipment already exists");

        shipments[shipmentId] = Shipment({
            shipmentId: shipmentId,
            origin: origin,
            destination: destination,
            category: category,
            maxTemp: maxTemp,
            maxHumidity: maxHumidity,
            escrowValue: escrowValue,
            receiver: address(0),
            shipper: msg.sender,
            status: Status.Pending,
            dispatchDate: uint64(block.timestamp)
        });

        emit ShipmentRegistered(shipmentId, msg.sender);
    }

    function updateStatus(bytes32 shipmentId, Status status) external onlyOracle {
        require(shipments[shipmentId].shipper != address(0), "Unknown shipment");
        shipments[shipmentId].status = status;
        emit StatusUpdated(shipmentId, status);
    }

    function flagBreached(bytes32 shipmentId, int256 temperature) external onlyOracle {
        shipments[shipmentId].status = Status.Disputed;
        emit BreachFlagged(shipmentId, temperature);
    }

    function getShipment(bytes32 shipmentId) external view returns (Shipment memory) {
        return shipments[shipmentId];
    }
}
