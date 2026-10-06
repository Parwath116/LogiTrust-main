# LogiTrust — Smart Supply Chain Management System

LogiTrust is a comprehensive, full-stack platform designed to revolutionize supply chain transparency. By combining Internet of Things (IoT) hardware telemetry, predictive Artificial Intelligence, and Ethereum-based smart contracts, LogiTrust provides an immutable, trustless escrow mechanism for high-value and climate-sensitive shipments.

---

## 🏗 System Architecture

The LogiTrust ecosystem consists of five deeply integrated layers:

### 1. IoT Hardware (Sensor Telemetry)
- **Tech Stack**: C++, Arduino Uno R4 WiFi / ESP32.
- **Features**: Physical microcontrollers attached to shipments that read real-time environmental data (Temperature, Humidity, GPS Coordinates). The data is securely transmitted over the MQTT protocol directly to the backend infrastructure.

### 2. Core API Service (Backend & Custodial Relayer)
- **Tech Stack**: Node.js, Express.js, Prisma ORM, PostgreSQL, MQTT (Mosquitto), ethers.js.
- **Features**: 
  - Subscribes to the MQTT broker to ingest live IoT telemetry and verify HMAC-SHA256 device signatures.
  - Exposes RESTful API endpoints for shipment lifecycle management.
  - Manages Role-Based Access Control (RBAC) via Google OAuth 2.0 (Shipper, Receiver, Admin).
  - Operates as a **custodial oracle relayer** on Ethereum Sepolia using a backend wallet (`DEPLOYER_PRIVATE_KEY`), executing smart contract calls on behalf of users so participants do not require browser wallet extensions (MetaMask) or direct gas funding while still providing verifiable on-chain transaction hashes.

### 3. Predictive AI Microservice (Advisory Spoilage Risk Engine)
- **Tech Stack**: Python, FastAPI, scikit-learn.
- **Features**: A lightweight microservice that computes live spoilage risk scores (0–100%) and risk bands using a Gradient Boosting Pipeline trained on a **synthetic cold-chain dataset** (modeling differential degradation across categories: pharma, dairy, produce, electronics, general).
- **Role**: Operates strictly in an **advisory and anomaly detection** capacity. When spoilage risk exceeds `AI_DISPUTE_THRESHOLD` (default: 80%), the shipment is flagged for Admin investigation (`adminFlagged: true`). Contractual auto-disputes are reserved for sustained, rule-based physical breaches.

### 4. Smart Contracts (Blockchain Layer)
- **Tech Stack**: Solidity (v0.8.20), Hardhat, Sepolia Testnet.
- **Features**: 
  - `ShipmentRegistry.sol`: Decentralized registry tracking shipment metadata hashes, on-chain statuses, and oracle breach flags.
  - `SmartEscrow.sol`: Holds payment funds in escrow. Features programmatic release upon server-verified geofence arrival and Receiver approval, a double-payout-protected dispute mechanism, and Admin resolution (Force Release vs. Force Refund).

### 5. Dashboard Client (Frontend)
- **Tech Stack**: HTML5, Vanilla JavaScript, CSS3, Leaflet.js.
- **Features**: A lightweight interface with zero heavy framework dependencies. Provides tailored, role-based dashboards (Shipper, Receiver, Admin) with live interactive mapping, real-time analytics polling, and on-chain transaction inspection links. Explicitly displays a "Simulated location" badge when telemetry originates from demo simulation.

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

#### Environment Variables Reference
| Variable | Description | Default / Example |
|---|---|---|
| `PORT` | Backend Express server port | `4000` |
| `CLIENT_URL` | Frontend origin for CORS and OAuth redirects | `http://localhost:3000` |
| `SESSION_SECRET` | Secret key used for session signing | random string |
| `JWT_SECRET` | Secret key used for authentication JWTs | random string |
| `ADMIN_EMAIL` | Email granted administrative role upon login | `admin@logitrust.local` |
| `BOOTSTRAP_SECRET` | Secret token to bootstrap admin roles via API | random secret |
| `DEVICE_SECRET` | Pre-shared key for hardware HMAC telemetry signatures | `logitrust_hardware_key_2026` |
| `MQTT_BROKER_URL` | URL of the MQTT broker | `mqtt://localhost:1883` |
| `MQTT_TOPIC` | Topic pattern server subscribes to (supports wildcards) | `logitrust/telemetry/#` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/logitrust` |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID | Cloud Console credential |
| `GOOGLE_CLIENT_SECRET`| Google OAuth Client Secret | Cloud Console credential |
| `SEPOLIA_RPC_URL` | Ethereum Sepolia JSON-RPC provider URL | Alchemy/Infura endpoint |
| `DEPLOYER_PRIVATE_KEY` | Private key of deployer/oracle wallet | Sepolia test wallet key |
| `SHIPMENT_REGISTRY_ADDRESS` | Address of deployed `ShipmentRegistry.sol` | Hex contract address |
| `SMART_ESCROW_ADDRESS` | Address of deployed `SmartEscrow.sol` | Hex contract address |
| `INR_PER_ETH` | Exchange rate used to convert INR (₹) to ETH for escrow lock | `250000` |
| `TEST_ETH_SCALE` | (Optional) direct scaling multiplier for INR to ETH | `0.000004` |
| `GEOFENCE_RADIUS_M` | Proximity radius in meters to destination for arrival geofence | `500` |
| `BREACH_CONSECUTIVE_COUNT` | Consecutive breached readings required to trigger auto-dispute | `3` |
| `BREACH_WINDOW_MIN` | Time window in minutes within which consecutive breaches must occur | `15` |
| `AI_DISPUTE_THRESHOLD` | AI spoilage risk score percentage that triggers flag-for-admin review | `80` |
| `EMAIL_USER` | Gmail address for automated notifications | `your_email@gmail.com` |
| `EMAIL_PASS` | Gmail App Password for SMTP authentication | 16-char app password |
| `AI_SERVICE_URL` | Endpoint of the FastAPI ML inference service | `http://localhost:8000` |

#### MQTT Broker Options (Docker Mosquitto vs. HiveMQ)
- **Local Demo (Default)**: Docker runs an Eclipse Mosquitto broker on port `1883`. The Arduino firmware (`LogiTrust_UnoR4.ino`) is configured to connect to your PC's LAN IP (e.g. `192.168.1.100`) on port `1883` with topic `logitrust/telemetry/uno-r4`.
- **HiveMQ Public Cloud Option**: For remote hardware testing across networks without port forwarding, configure:
  1. In `arduino/LogiTrust_UnoR4/LogiTrust_UnoR4.ino`: set `mqtt_server = "broker.hivemq.com"`.
  2. In `server/.env`: set `MQTT_BROKER_URL=mqtt://broker.hivemq.com:1883`.
  3. The server subscribes with the wildcard `logitrust/telemetry/#` and will accept packets from any matching device topic.

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

## 🚛 Telemetry Route Simulator

For demonstrations and automated testing without physical hardware, run the route simulator:

```bash
# In server directory or with node:
node scripts/simulator.js --shipment SHP-123456 --origin Mumbai --dest Pune --cadence 3 --steps 15

# Or to simulate a critical temperature breach:
node scripts/simulator.js --shipment SHP-123456 --origin Mumbai --dest Pune --breach
```

The simulator generates interpolated coordinates along the route, adds realistic noise, signs every payload with the shared secret (`sim:true`), and delivers consecutive readings within the geofence radius (`GEOFENCE_RADIUS_M`, default: `500` meters) upon destination arrival.

---

## 🔄 Shipment Workflow & Lifecycle

1. **Onboarding**: Users authenticate via Google OAuth and are assigned a persistent role (`SHIPPER` or `RECEIVER`, with `ADMIN` reserved for `ADMIN_EMAIL`). Users do not need to install browser wallet extensions (MetaMask); the backend acts as a custodial oracle relayer submitting verified on-chain transactions on Sepolia.
2. **Registration**: The Shipper registers a new shipment. Escrow funds (converted from ₹ INR to ETH using `INR_PER_ETH`) are locked in the `SmartEscrow` contract on-chain, and metadata is registered in `ShipmentRegistry`.
3. **In-Transit**: The IoT hardware (or route simulator) streams live telemetry signed via HMAC-SHA256. The AI microservice computes continuous spoilage risk scores (0–100%). If the risk score reaches `AI_DISPUTE_THRESHOLD` (80%), the shipment is flagged for Admin investigation (`adminFlagged: true`).
4. **Resolution**: 
   - **Success**: The shipment physically arrives at the destination. Once the server confirms 3 consecutive readings within `GEOFENCE_RADIUS_M` (500m), `arrivedAt` is recorded and the on-chain geofence is marked. The Receiver can then approve the escrow release, prompting the backend oracle to call `releaseEscrow` on-chain.
   - **Dispute**: If the shipment incurs sustained rule-based breaches (`BREACH_CONSECUTIVE_COUNT` consecutive breaches within `BREACH_WINDOW_MIN` minutes), or if the Receiver/Shipper flags an issue, the shipment state transitions to `DISPUTED` and `disputeEscrow` is executed on-chain. Admins investigate and resolve disputes via the Admin Console (`Force Release` to Shipper vs. `Force Refund` to Receiver).

---

## 👥 Role-Based Capabilities & Edge Cases

The system enforces strict State Machine rules and Role-Based Access Controls to handle various supply chain edge cases.

### 1. The Shipper (Sender)
The Shipper is responsible for initializing the shipment, selecting the destination city, locking funds into escrow via the custodial relayer, and assigning a hardware sensor ID.
- **Flagging Delays**: If a shipment encounters transit delays (e.g., customs hold or road blockage), the Shipper can manually click **Flag Delay**, alerting the Admin to review the route.
- **View Restrictions**: Shippers only view telemetry and escrow statuses for shipments they created.

### 2. The Receiver (Buyer)
The Receiver is the destination party whose incoming goods are protected by smart escrow.
- **Approve Release**: Unlocked strictly after server-verified geofence arrival (`arrivedAt != null`). Triggers on-chain escrow fund release to the Shipper.
- **Manual Dispute**: If the goods arrive damaged or tampered with, the Receiver can click **Dispute**, halting the escrow and escalating to the Admin.

### 3. The Admin (Arbitrator & Oracle Controller)
The Admin oversees all shipments and serves as the dispute resolution authority for deadlocked or disputed escrows.
- **AI Anomaly Signals & Rule Breaches**: When the AI detects high spoilage risk (>= 80%), shipments are flagged for review. When physical sensors record sustained breaches, auto-dispute locks the contract.
- **Dispute Resolution (Force Release vs. Force Refund)**:
  - If the Admin determines the Shipper fulfilled obligations, they execute **Force Release** (`RELEASE_FUNDS`), paying the Shipper via the smart contract.
  - If the goods were spoiled or lost in transit, the Admin executes **Force Refund** (`REFUND_RECEIVER`), returning the escrow balance to the Receiver.
- **Platform Visibility**: Admins have global visibility over all shipments, sensor streams, AI spoilage indicators, and Sepolia transaction hashes.

