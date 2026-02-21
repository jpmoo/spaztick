#!/usr/bin/env node
/** Run electron-builder with immediate logging so we can see where it hangs. */
const { spawn } = require("child_process");

console.log("[build-with-log] Starting...");
const child = spawn(
  "npx",
  ["electron-builder", "--dir"],
  {
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
    stdio: "inherit",
    cwd: __dirname,
  }
);
child.on("error", (err) => {
  console.error("[build-with-log] Spawn error:", err);
  process.exit(1);
});
child.on("exit", (code, sig) => {
  console.log("[build-with-log] Exit code:", code, "signal:", sig);
  process.exit(code != null ? code : 1);
});
