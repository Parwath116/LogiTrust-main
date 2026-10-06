import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "/auth/google/callback",
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        let user = await prisma.user.findUnique({ where: { googleId: profile.id } });

        let role = "SHIPPER"; // Default fallback
        if (req.query.state) {
          const stateObj = JSON.parse(Buffer.from(req.query.state, 'base64').toString());
          if (stateObj.role) role = stateObj.role;
        }

        // Hardcode Admin Email security check
        if (role === "ADMIN") {
          const adminEmail = process.env.ADMIN_EMAIL || "admin@logitrust.local";
          if (email !== adminEmail) {
            return done(new Error("Unauthorized: Email does not match Admin whitelist."), null);
          }
        }

        if (!user) {
          user = await prisma.user.create({
            data: {
              googleId: profile.id,
              email,
              name: profile.displayName,
              avatarUrl: profile.photos?.[0]?.value,
              role,
            },
          });
        } else {
          // Keep name, avatar, and role synced with Google / State
          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              name: profile.displayName,
              avatarUrl: profile.photos?.[0]?.value,
              role,
            }
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
