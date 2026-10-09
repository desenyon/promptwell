import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

// Standalone test harness; never part of Next routes or the production auth path.
const bundle = await build({
  entryPoints: ["tests/browser/entry.tsx"], bundle: true, write: false,
  outdir: "fixture", format: "esm", define: { "process.env.NODE_ENV": '"test"' },
  plugins: [{ name: "test-logout", setup(builder) {
    builder.onResolve({ filter: /app\/auth\/actions$/ }, () => ({ path: "logout", namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export async function logout() {}" }));
  } }],
});
const html = '<!doctype html><html><head><link rel="stylesheet" href="/entry.css"></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>';
const assets = new Map(bundle.outputFiles.map((f) => ["/" + f.path.split("/").pop(), f.contents]));
const server = createServer(async (request, response) => {
  if (request.url === "/") { response.setHeader("Content-Type", "text/html"); response.end(html); return; }
  if (assets.has(request.url)) { response.setHeader("Content-Type", request.url.endsWith(".css") ? "text/css" : "text/javascript"); response.end(assets.get(request.url)); return; }
  if (request.url === "/favicon.ico") { response.end(); return; }
  // Only this known public asset is exposed; no arbitrary filesystem reads.
  if (request.url === "/noise.svg") { response.end(await readFile("public/noise.svg").catch(() => "")); return; }
  response.writeHead(404).end();
});
server.listen(4177, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
