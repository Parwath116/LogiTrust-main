import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import passport from "./config/passport.js";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth.js";
import shipmentRoutes from "./routes/shipments.js";
import escrowRoutes from "./routes/escrow.js";
import sensorRoutes from "./routes/sensors.js";
import { startMqttService } from "./services/mqtt.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  })
);
app.use(passport.initialize());
app.use(passport.session());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // increased for dev
});
const sensorLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120, // limit sensors to 2 requests per second essentially
});

app.use("/auth", authRoutes); // Removed authLimiter to prevent lockouts during dev testing
app.use("/api/shipments", shipmentRoutes);
app.use("/api/escrow", escrowRoutes);
app.use("/api/sensors", sensorLimiter, sensorRoutes);

app.get("/health", (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`LogiTrust API running on http://localhost:${port}`);
  startMqttService();
});
