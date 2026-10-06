import { Router } from "express";
import passport from "passport";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

// Step 1: kick off Google OAuth
router.get("/google", (req, res, next) => {
  const role = req.query.role || "SHIPPER";
  const state = Buffer.from(JSON.stringify({ role })).toString('base64');
  passport.authenticate("google", { scope: ["profile", "email"], state })(req, res, next);
});

// Step 2: Google redirects here after consent
router.get(
  "/google/callback",
  passport.authenticate("google", { session: true, failureRedirect: "/login-failed" }),
  (req, res) => {
    const token = jwt.sign(
      { userId: req.user.id, role: req.user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    // Hand the JWT back to the frontend via a redirect with the token in the URL fragment
    res.redirect(`${process.env.CLIENT_URL}/auth-success.html#token=${token}`);
  }
);

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

// Admin-only: promote a user to a role (admin/shipper/receiver)
router.post("/set-role", async (req, res) => {
  const bootstrapSecret = req.headers["x-bootstrap-secret"] || req.query.secret;
  if (!process.env.BOOTSTRAP_SECRET || bootstrapSecret !== process.env.BOOTSTRAP_SECRET) {
    return res.status(403).json({ error: "Invalid bootstrap secret" });
  }

  const { userId, role } = req.body;
  const user = await prisma.user.update({ where: { id: userId }, data: { role } });
  res.json(user);
});

router.get("/logout", (req, res) => {
  req.logout(() => res.redirect(process.env.CLIENT_URL));
});

export default router;
