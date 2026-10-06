import { Router } from "express";
import passport from "passport";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { signOAuthState } from "../utils/oauthState.js";

const prisma = new PrismaClient();
const router = Router();

// Step 1: kick off Google OAuth with signed state and validated role
router.get("/google", (req, res, next) => {
  const role = (req.query.role || "SHIPPER").toString().toUpperCase();
  const validRoles = ["SHIPPER", "RECEIVER"];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: "Invalid role. Role must be SHIPPER or RECEIVER" });
  }

  const state = signOAuthState({ role, nonce: crypto.randomBytes(16).toString("hex") });
  passport.authenticate("google", { scope: ["profile", "email"], state })(req, res, next);
});

// Step 2: Google redirects here after consent
router.get("/google/callback", (req, res, next) => {
  passport.authenticate("google", { session: true }, (err, user, info) => {
    if (err) {
      console.warn("[Auth] Google OAuth callback error:", err.message);
      return res.redirect(`${process.env.CLIENT_URL || "http://localhost:3000"}/auth-success.html#error=${encodeURIComponent(err.message)}`);
    }
    if (!user) {
      const msg = info && info.message ? info.message : "Authentication failed";
      return res.redirect(`${process.env.CLIENT_URL || "http://localhost:3000"}/auth-success.html#error=${encodeURIComponent(msg)}`);
    }

    req.logIn(user, (loginErr) => {
      if (loginErr) {
        console.warn("[Auth] Session login error:", loginErr.message);
        return res.redirect(`${process.env.CLIENT_URL || "http://localhost:3000"}/auth-success.html#error=${encodeURIComponent(loginErr.message)}`);
      }
      const token = jwt.sign(
        { userId: user.id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: "8h" }
      );

      // Destroy transient session to ensure stateless JWT usage
      if (req.session) {
        req.session.destroy(() => {
          res.redirect(`${process.env.CLIENT_URL || "http://localhost:3000"}/auth-success.html#token=${token}`);
        });
      } else {
        res.redirect(`${process.env.CLIENT_URL || "http://localhost:3000"}/auth-success.html#token=${token}`);
      }
    });
  })(req, res, next);
});

// Frontend calls this with the JWT to get the current user + role
router.get("/me", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "No token" });
  try {
    const token = authHeader.replace("Bearer ", "");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role, avatarUrl: user.avatarUrl });
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

// Fetch notifications for the current user
router.get("/notifications", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "No token" });
  try {
    const token = authHeader.replace("Bearer ", "");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const notifications = await prisma.notification.findMany({
      where: { userId: decoded.userId },
      orderBy: { createdAt: "desc" },
    });
    res.json(notifications);
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

// Admin-only: promote a user to a role (ADMIN/SHIPPER/RECEIVER)
router.post("/set-role", async (req, res) => {
  const bootstrapSecret = req.headers["x-bootstrap-secret"];
  let isAuthorized = false;

  if (process.env.BOOTSTRAP_SECRET && bootstrapSecret && bootstrapSecret === process.env.BOOTSTRAP_SECRET) {
    isAuthorized = true;
  } else {
    // Check if caller is authenticated ADMIN
    const authHeader = req.headers.authorization;
    if (authHeader) {
      try {
        const token = authHeader.replace("Bearer ", "");
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.role === "ADMIN") isAuthorized = true;
      } catch {}
    }
  }

  if (!isAuthorized) {
    return res.status(403).json({ error: "Unauthorized: Invalid bootstrap secret or non-admin" });
  }

  const { userId, role } = req.body;
  const validRoles = ["ADMIN", "SHIPPER", "RECEIVER"];
  if (!role || !validRoles.includes(role)) {
    return res.status(400).json({ error: "Invalid role. Role must be ADMIN, SHIPPER, or RECEIVER" });
  }

  try {
    const user = await prisma.user.update({ where: { id: userId }, data: { role } });
    res.json(user);
  } catch (err) {
    res.status(404).json({ error: "User not found or role update failed" });
  }
});

router.get("/logout", (req, res) => {
  req.logout(() => res.redirect(process.env.CLIENT_URL));
});

export default router;
