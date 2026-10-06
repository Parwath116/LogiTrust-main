# LogiTrust — Smart Supply Chain Management System

LogiTrust is a comprehensive, full-stack platform designed to revolutionize supply chain transparency. By combining Internet of Things (IoT) hardware telemetry, predictive Artificial Intelligence, and Ethereum-based smart contracts, LogiTrust provides an immutable, trustless escrow mechanism for high-value and climate-sensitive shipments.

---

## 🏗 System Architecture

The LogiTrust ecosystem consists of five deeply integrated layers:

### 1. IoT Hardware (Sensor Telemetry)
- **Tech Stack**: C++, Arduino Uno R4 WiFi / ESP32.
- **Features**: Physical microcontrollers attached to shipments that read real-time environmental data (Temperature, Humidity, GPS Coordinates). The data is securely transmitted over the MQTT protocol directly to the backend infrastructure.

### 2. Core API Service (Backend)
- **Tech Stack**: Node.js, Express.js, Prisma ORM, PostgreSQL, MQTT (Mosquitto).
- **Features**: 
  - Subscribes to the MQTT broker to ingest live IoT telemetry.
  - Exposes RESTful API endpoints for shipment lifecycle management.
  - Manages Role-Based Access Control (RBAC) via Google OAuth 2.0 (Shipper, Receiver, Admin).
  - Handles automated blockchain transaction triggers using `ethers.js` when consensus conditions are met.

### 3. Predictive AI Microservice (Spoilage Risk Engine)
- **Tech Stack**: Python, FastAPI, scikit-learn.
- **Features**: A continuously running microservice that ingests real-time telemetry from the backend. It applies a pre-trained machine learning model (`spoilage_model.joblib`) to calculate dynamic risk scores. If environmental anomalies (like a temperature breach) exceed critical thresholds, the backend is immediately signaled to automatically halt the blockchain escrow and flag a dispute.

### 4. Smart Contracts (Blockchain Layer)
- **Tech Stack**: Solidity, Hardhat, Sepolia Testnet.
- **Features**: 
  - `ShipmentRegistry.sol`: Maintains an immutable, decentralized ledger of all registered shipments and their metadata hashes.
  - `SmartEscrow.sol`: Holds the payment funds in escrow. It programmatically releases the funds to the Shipper upon successful delivery validation, or routes the funds to an Admin dispute-resolution mechanism if the AI flags a breach.

### 5. Dashboard Client (Frontend)
- **Tech Stack**: HTML5, Vanilla JavaScript, CSS3, Leaflet.js.
- **Features**: A lightweight, lightning-fast client interface with zero heavy framework dependencies. Provides tailored, role-based dashboards (Shipper, Receiver, Admin) with live interactive mapping, real-time analytics polling, and Web3 action triggers.

---

## 📁 Directory Structure

```text
logitrust/
├── frontend/       # Client-side UI, Leaflet maps, API consumption logic
├── server/         # Express backend, Prisma schema, API routes, MQTT subscriber
├── contracts/      # Solidity smart contracts and Hardhat deployment scripts
├── ai-service/     # FastAPI Python microservice and ML model definitions
├── arduino/        # C++ firmware for the Arduino Uno R4 WiFi (IoT)
└── docker-compose.yml # Container orchestration configuration
```

---

## 🚀 Deployment Guide

### Prerequisites
- **Docker and Docker Compose** (Recommended)
- Node.js (v18+) & Python (3.9+) *(Only required for manual/bare-metal deployment)*
- An Ethereum Wallet with Sepolia Testnet ETH (e.g., MetaMask + Sepolia Faucet)
- Google Cloud Console account (for OAuth 2.0 Credentials)

### 1. Environment Configuration

Navigate to the `server` directory and copy the environment template:
```bash
cd server
cp .env.example .env
```
Open the `.env` file and configure your Google OAuth Client IDs, Sepolia RPC URL (via Infura/Alchemy), and your Wallet Private Key. 

> **Note:** If using the recommended Docker deployment, the `DATABASE_URL` and `MQTT_BROKER_URL` will automatically be overridden to route to the internal containers.

### 2. Launch the Platform (Docker Compose)

The entire LogiTrust stack (Database, MQTT Broker, Backend API, AI Microservice, and Frontend Client) is containerized for a seamless, one-click deployment.

From the root `logitrust/` directory, execute:
```bash
docker-compose up --build -d
```

The platform is now live across your local ports:
- **Frontend UI**: `http://localhost:3000`
- **Backend API**: `http://localhost:4000`
- **AI Microservice**: `http://localhost:8000`
- **MQTT Broker**: `localhost:1883`

---

## 📜 Smart Contract Deployment (Optional)

If you wish to deploy fresh instances of the Escrow and Registry contracts to the Sepolia blockchain:

```bash
cd contracts
npm install
npx hardhat compile
npm run deploy:sepolia
```
*Take note of the outputted contract addresses and add them to your `server/.env` file as `SHIPMENT_REGISTRY_ADDRESS` and `SMART_ESCROW_ADDRESS`, then restart your docker containers.*

---

---

## 🔄 Shipment Workflow & Lifecycle

1. **Onboarding**: Users authenticate via Google OAuth and are assigned a role (`SHIPPER`, `RECEIVER`, or `ADMIN`).
2. **Registration**: The Shipper registers a new shipment. Real funds are securely locked in the `SmartEscrow` contract on-chain.
3. **In-Transit**: The IoT hardware streams live GPS and environmental telemetry. The AI microservice continuously analyzes this stream for spoilage risks.
4. **Resolution**: 
   - **Success**: The shipment arrives safely. The Receiver approves the shipment via the UI, triggering the smart contract to release funds directly to the Shipper's wallet.
   - **Dispute**: If the AI detects a critical environmental breach mid-transit, or if the Receiver flags an issue upon arrival, the shipment is locked. Admins step in to resolve the dispute and distribute funds via the Admin Console.

---

## 👥 Role-Based Capabilities & Edge Cases

The system enforces strict State Machine rules and Role-Based Access Controls to handle various supply chain edge cases.

### 1. The Shipper (Sender)
The Shipper is responsible for initializing the contract, defining the origin/destination, locking funds in escrow, and physically dispatching the goods.
- **Flagging Delays**: If a shipment gets stuck in transit (e.g., customs hold or vehicle breakdown), the Shipper can manually trigger a **Flag Delay**. This alters the UI state for all parties, freezing the expected arrival timers and alerting the Admin that manual intervention or route adjustment may be required.
- **View Restrictions**: Shippers can only view telemetry and escrow statuses for shipments they explicitly created.

### 2. The Receiver (Buyer)
The Receiver is the destination party whose funds are held in escrow. They rely on the platform to guarantee the goods arrive un-spoiled before payment is released.
- **Approve Release**: When the GPS telemetry verifies that the truck has physically arrived at the destination bounds, the "Approve Release" action is unlocked. Clicking this signs a transaction to the Smart Contract, paying the Shipper.
- **Manual Dispute**: If the goods arrive damaged (e.g., physical box tampering not caught by internal sensors), the Receiver can trigger a **Dispute**. This instantly halts the escrow contract. The funds cannot be withdrawn by the Shipper, and the case is escalated to the Admin.

### 3. The Admin (Arbitrator)
The Admin acts as the ultimate Oracle and dispute resolution authority over the platform, safeguarding the Smart Contracts from deadlocks.
- **AI Breaches**: If the IoT temperature/humidity sensors detect an anomaly, the FastAPI AI Microservice will automatically flag the shipment as `DISPUTED`. The Admin is immediately notified.
- **Dispute Resolution (Force Release vs. Force Refund)**:
  - If the Admin investigates a dispute (whether raised manually by the Receiver, raised manually by the Shipper via 'Flag Delay', or triggered automatically by the AI) and determines the Shipper was NOT at fault, the Admin executes a **Force Release**, pushing the escrowed funds to the Shipper.
  - If the Admin determines the goods were spoiled or lost, they execute a **Force Refund**, returning the escrowed funds to the Receiver.
- **God-View**: Admins have global visibility over all shipments, active telemetry routes, and platform-wide metrics.
