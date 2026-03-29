import cookieParser from "cookie-parser";
import express from "express";
import session from "express-session";

import { cookieSecret, csrfSecret, sessionSecret } from "./config";
import { createCsrfProtection, generalLimiter } from "./middleware";
import { authRouter } from "./routes/auth";
import { passkeysRouter } from "./routes/passkeys";
import { sensitiveRouter } from "./routes/sensitive";
import { userRouter } from "./routes/user";

const app = express();
app.use(express.json());
app.use(cookieParser(cookieSecret));

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 10 * 60 * 1000,
    },
  }),
);

// --- CSRF ---
const { generateToken, doubleCsrfProtection } = createCsrfProtection(csrfSecret);

app.get("/api/csrf-token", (req, res) => {
  const token = generateToken(req, res);
  res.json({ token });
});

app.use(doubleCsrfProtection);

// --- Rate limiting ---
app.use("/api", generalLimiter);

// --- Routes ---
app.use("/api/auth", authRouter);
app.use("/api", userRouter);
app.use("/api/passkeys", passkeysRouter);
app.use("/api/sensitive", sensitiveRouter);

export default app;
