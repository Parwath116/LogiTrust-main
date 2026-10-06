import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { PrismaClient } from "@prisma/client";
import { verifyOAuthState } from "../utils/oauthState.js";

const prisma = new PrismaClient();

passport.use(
  new GoogleStrategy(
    {
      clientID: (process.env.GOOGLE_CLIENT_ID || "placeholder_google_client_id").trim(),
      clientSecret: (process.env.GOOGLE_CLIENT_SECRET || "placeholder_google_client_secret").trim(),
      callbackURL: process.env.GOOGLE_CALLBACK_URL || "http://localhost:4000/auth/google/callback",
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        let user = await prisma.user.findUnique({ where: { googleId: profile.id } });

        let requestedRole = "SHIPPER";
        if (req.query.state) {
          const verified = verifyOAuthState(req.query.state);
          if (!verified) {
            return done(new Error("Invalid or tampered OAuth state parameter."), null);
          }
          if (verified.role) requestedRole = verified.role;
        }

        // Support single email or comma-separated list of ADMIN_EMAILs
        const adminEmails = (process.env.ADMIN_EMAIL || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
        const isAdmin = Boolean(email && adminEmails.includes(email.trim().toLowerCase()));

        if (requestedRole === "ADMIN" && !isAdmin) {
          return done(new Error(`Unauthorized: ${email} is not recognized as an Administrator. Add it to ADMIN_EMAIL in server/.env to grant Admin access.`), null);
        }

        if (!user) {
          // First login: persist chosen role (or ADMIN if email matches)
          const assignedRole = isAdmin ? "ADMIN" : (requestedRole === "RECEIVER" ? "RECEIVER" : "SHIPPER");
          user = await prisma.user.create({
            data: {
              googleId: profile.id,
              email,
              name: profile.displayName,
              avatarUrl: profile.photos?.[0]?.value,
              role: assignedRole,
            },
          });
        } else {
          // Later logins: NEVER overwrite user role from request!
          // Only promote to ADMIN if email matches ADMIN_EMAIL and user is not yet ADMIN.
          const updateData = {
            name: profile.displayName,
            avatarUrl: profile.photos?.[0]?.value,
          };
          if (isAdmin && user.role !== "ADMIN") {
            updateData.role = "ADMIN";
          }
          user = await prisma.user.update({
            where: { id: user.id },
            data: updateData,
          });
        }
        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const user = await prisma.user.findUnique({ where: { id } });
  done(null, user);
});

export default passport;
