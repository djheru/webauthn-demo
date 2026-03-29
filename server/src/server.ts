import app from "./app";

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`✦ Passkey Vault server on http://localhost:${PORT}`);
});
