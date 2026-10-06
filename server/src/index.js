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

if (!process.env.DEVICE_SECRET) {
  console.error("FATAL: DEVICE_SECRET environment variable is unset. Server startup failed.");
  process.exit(1);
}

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: [
          "'self'",
          "data:",
          "https://*.tile.openstreetmap.org",
          "https://unpkg.com",
          "https://*.googleusercontent.com",
        ],
        connectSrc: [
          "'self'",
          "https://nominatim.openstreetmap.org",
          process.env.CLIENT_URL || "http://localhost:3000",
          "http://localhost:4000",
          "http://localhost:8000",
        ],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "default_session_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 1000 * 60 * 60, // 1 hour for OAuth handshake
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
});
const sensorLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120, // limit sensors to 2 requests per second essentially
});

app.use("/auth", authLimiter, authRoutes);
app.use("/api/shipments", shipmentRoutes);
app.use("/api/escrow", escrowRoutes);
app.use("/api/sensors", sensorLimiter, sensorRoutes);

app.get("/health", (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`LogiTrust API running on http://localhost:${port}`);
  startMqttService();
});
