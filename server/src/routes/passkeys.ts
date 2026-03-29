import express from "express";
import { deletePasskey, logAuditEvent, renamePasskey } from "../db";
import { getClientIp, requireSession } from "../middleware";

export const passkeysRouter = express.Router();

passkeysRouter.patch("/:id", requireSession, (req: express.Request<{ id: string }>, res) => {
  const { label } = req.body;
  if (!label || typeof label !== "string" || label.length > 64) {
    return res
      .status(400)
      .json({ error: "Label is required (max 64 characters)" });
  }

  renamePasskey(req.params.id, req.session.userId!, label.trim());
  logAuditEvent(
    req.session.userId!,
    "passkey.renamed",
    `${req.params.id.substring(0, 16)}… → ${label}`,
    getClientIp(req),
  );
  res.json({ ok: true });
});

passkeysRouter.delete("/:id", requireSession, (req: express.Request<{ id: string }>, res) => {
  const deleted = deletePasskey(req.params.id, req.session.userId!);
  if (!deleted) {
    return res.status(400).json({
      error:
        "Cannot delete. Either not found or it is your only remaining credential.",
    });
  }

  logAuditEvent(
    req.session.userId!,
    "passkey.revoked",
    `${req.params.id.substring(0, 16)}…`,
    getClientIp(req),
  );
  res.json({ ok: true });
});
