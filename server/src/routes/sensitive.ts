import express from "express";
import { logAuditEvent } from "../db";
import { getClientIp, requireRecentStepUp, requireSession } from "../middleware";

export const sensitiveRouter = express.Router();

// Example protected route — replace or extend for your use case
sensitiveRouter.post(
  "/action",
  requireSession,
  requireRecentStepUp,
  (req, res) => {
    logAuditEvent(
      req.session.userId!,
      "sensitive.action",
      JSON.stringify(req.body),
      getClientIp(req),
    );
    res.json({ ok: true, message: "Sensitive Action processed" });
  },
);
