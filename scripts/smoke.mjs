import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const port = 4178;
const base = `http://127.0.0.1:${port}`;
// Deliberately fake test credentials. No real WorkOS/OpenAI request is made.
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  env: { ...process.env, WORKOS_CLIENT_ID: "client_smoke", WORKOS_API_KEY: "sk_test_smoke",
    WORKOS_COOKIE_PASSWORD: "smoke-only-cookie-password-32-characters-long",
    NEXT_PUBLIC_WORKOS_REDIRECT_URI: `${base}/auth/callback` },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
server.stdout.on("data", (data) => { logs += data; });
server.stderr.on("data", (data) => { logs += data; });
const exit = once(server, "exit");
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error(`Server exited: ${logs}`);
    try {
      const response = await fetch(`${base}/`, { redirect: "manual", signal: AbortSignal.timeout(1000) });
      if (response.status === 307) { ready = true; break; }
    } catch { /* Wait for this process to start. */ }
    await delay(250);
  }
  assert.ok(ready, `Server did not become ready: ${logs}`);
  for (const [path, method] of [["profile", "GET"], ["profile", "PUT"], ["sessions", "GET"], ["sessions", "PUT"], ["sessions", "DELETE"], ["refine", "POST"]]) {
    const response = await fetch(`${base}/api/${path}`, { method, redirect: "manual", signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 401, `${method} /api/${path}: ${await response.text()}`);
  }
  console.log("Production smoke passed: home redirects to sign-in; all six API operations reject anonymous requests.");
} finally {
  server.kill("SIGTERM");
  const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
  await exit;
  clearTimeout(timer);
}
