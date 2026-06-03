const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outputsDir = path.join(root, "outputs");

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        let payload = null;
        try {
          payload = body ? JSON.parse(body) : null;
        } catch (error) {
          reject(new Error(`Invalid JSON from ${url}: ${error.message}`));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}: ${body}`));
          return;
        }
        resolve(payload);
      });
    });
    req.on("error", reject);
    req.end(options.body || undefined);
  });
}

async function findEndpoint() {
  for (let port = 7860; port <= 7870; port += 1) {
    const endpoint = `http://127.0.0.1:${port}`;
    try {
      const health = await requestJson(`${endpoint}/health`, { method: "GET", timeout: 3000 });
      if (health?.ok) return { endpoint, health };
    } catch {
      // Try the next local fallback port.
    }
  }
  throw new Error("Ideogram API is not reachable on ports 7860-7870.");
}

async function main() {
  const { endpoint, health } = await findEndpoint();
  if (!health.running) throw new Error("API reports running=false.");
  if (health.busy) throw new Error("API is busy; rerun this test when generation is idle.");
  if (!health.system?.paths?.outputs) throw new Error("Health response is missing output path.");

  const gallery = await requestJson(`${endpoint}/gallery`, { method: "GET" });
  if (!gallery?.ok || !Array.isArray(gallery.images)) throw new Error("Gallery response is malformed.");
  const appleDouble = gallery.images.find((item) => item.name.startsWith("._"));
  if (appleDouble) throw new Error(`Gallery exposed AppleDouble file: ${appleDouble.name}`);

  const source = gallery.images.find((item) => fs.existsSync(item.path));
  if (!source) throw new Error("Need at least one existing generated image for delete smoke test.");

  const tempName = `api-delete-smoke-${Date.now()}.png`;
  const tempPath = path.join(outputsDir, tempName);
  fs.copyFileSync(source.path, tempPath);

  const deleted = await requestJson(`${endpoint}/gallery/${encodeURIComponent(tempName)}`, { method: "DELETE" });
  if (!deleted?.ok) throw new Error("Delete endpoint returned ok=false.");
  if (fs.existsSync(tempPath)) throw new Error("Delete endpoint did not remove the temp image from outputs.");
  if (deleted.images.some((item) => item.name === tempName || item.name.startsWith("._"))) {
    throw new Error("Delete response still contains temp or AppleDouble entries.");
  }

  console.log(JSON.stringify({
    ok: true,
    endpoint,
    galleryCount: gallery.images.length,
    deleted: tempName
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
