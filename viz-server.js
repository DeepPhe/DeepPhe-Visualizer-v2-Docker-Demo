const express = require("express");
const fs = require("fs");
const path = require("path");
const { createPiperRouter } = require("./src/piper-server/router");

const PORT = process.env.PORT || 3000;
const DEEPPHE_API_LOCATION = (
  process.env.DEEPPHE_API_LOCATION || "http://localhost:3333"
).replace(/\/+$/, "");
const DEEPPHE_API_BASE_PATH = "/v1/deepphe-api";
const BUILD_DIR = path.join(__dirname, "build");
const INDEX_HTML_PATH = path.join(BUILD_DIR, "index.html");

const hopByHopHeaders = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

let indexHtml;
try {
  indexHtml = fs.readFileSync(INDEX_HTML_PATH, "utf-8");
} catch (error) {
  console.error(`Failed to read ${INDEX_HTML_PATH}: ${error.message}`);
  process.exit(1);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function copyRequestHeaders(req) {
  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    const lowerName = name.toLowerCase();
    if (hopByHopHeaders.has(lowerName) || lowerName === "host") {
      continue;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => headers.append(name, item));
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

  return headers;
}

function copyResponseHeaders(upstreamRes, res) {
  upstreamRes.headers.forEach((value, name) => {
    if (!hopByHopHeaders.has(name.toLowerCase())) {
      res.setHeader(name, value);
    }
  });
}

async function proxyToDataApi(req, res) {
  try {
    const upstreamUrl = new URL(req.originalUrl, DEEPPHE_API_LOCATION);
    const init = {
      method: req.method,
      headers: copyRequestHeaders(req),
      redirect: "manual",
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      const body = await readRequestBody(req);
      init.body = body.length > 0 ? body : undefined;
    }

    const upstreamRes = await fetch(upstreamUrl, init);
    const payload = Buffer.from(await upstreamRes.arrayBuffer());

    res.status(upstreamRes.status);
    copyResponseHeaders(upstreamRes, res);
    res.send(payload);
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }

    res.status(502).json({
      error: `Failed to proxy DeepPhe API request to ${DEEPPHE_API_LOCATION}: ${error.message}`,
    });
  }
}

const app = express();

app.get("/openapi.json", async (req, res) => {
  try {
    const upstreamRes = await fetch(`${DEEPPHE_API_LOCATION}/openapi.json`, {
      headers: { Accept: "application/json" },
    });

    if (!upstreamRes.ok) {
      res.status(502).json({
        error: `Upstream DeepPhe API returned ${upstreamRes.status} for /openapi.json`,
      });
      return;
    }

    const spec = await upstreamRes.json();
    spec.servers = [{ url: DEEPPHE_API_BASE_PATH }];
    res.json(spec);
  } catch (error) {
    res.status(502).json({
      error: `Failed to reach upstream DeepPhe API at ${DEEPPHE_API_LOCATION}: ${error.message}`,
    });
  }
});

app.use((req, res, next) => {
  if (req.url === DEEPPHE_API_BASE_PATH || req.url.startsWith(`${DEEPPHE_API_BASE_PATH}/`)) {
    proxyToDataApi(req, res);
    return;
  }

  next();
});

app.use(createPiperRouter());

app.get("/healthz", (req, res) => {
  res.json({ status: "ok", upstream: DEEPPHE_API_LOCATION });
});

app.use(
  express.static(BUILD_DIR, {
    maxAge: "1y",
    etag: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  })
);

app.use((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(404).end();
    return;
  }

  res.setHeader("Cache-Control", "no-cache");
  res.type("html").send(indexHtml);
});

app.listen(PORT, () => {
  console.log(`DeepPhe Visualizer v2 running on http://localhost:${PORT}`);
  console.log(`Proxying DeepPhe data API -> ${DEEPPHE_API_LOCATION}`);
});
