import express from "express";
import { findUserById, getPasskeysByUser } from "../db";
import { requireSession } from "../middleware";

export const userRouter = express.Router();

userRouter.get("/me", requireSession, (req, res) => {
  const user = findUserById(req.session.userId!);
  if (!user) return res.status(404).json({ error: "User not found" });

  const passkeys = getPasskeysByUser(user.id);
  res.json({
    id: user.id,
    email: user.email,
    passkeys: passkeys.map((pk) => ({
      id: pk.id,
      label: pk.label,
      deviceType: pk.device_type,
      backedUp: pk.backed_up === 1,
      createdAt: pk.created_at,
      lastUsedAt: pk.last_used_at,
    })),
  });
});
