/* setupProxy.js — dev-server proxy to the backend API.
 *
 * Why this exists: the browser was making cross-origin calls straight to
 * https://phd-navigator-api.onrender.com. That is a hostname a blocker can
 * pattern-match — `*.onrender.com` sits on several ad-block and privacy lists
 * because free hosting gets abused — and when an extension matches it, the
 * request dies as `TypeError: Failed to fetch` before it ever leaves the
 * browser. No amount of app-side error handling can rescue that.
 *
 * Routing through our own origin removes the problem rather than working
 * around it: the page calls /api/... on localhost:3000, there is nothing
 * third-party to match, and there is no CORS exchange at all.
 *
 * The deployed equivalent is the /api rewrite in vercel.json — keep the two
 * in step.
 *
 * CRA loads this automatically; it needs no import.
 */
const { createProxyMiddleware } = require("http-proxy-middleware");

const TARGET = process.env.PHD_API_TARGET || "https://phd-navigator-api.onrender.com";

module.exports = function (app) {
  const proxy = createProxyMiddleware({
    target: TARGET,
    changeOrigin: true,           // send the API its own Host, not localhost:3000
    secure: true,
    xfwd: true,
    ws: false,
    // Streaming chat must not be buffered, or tokens arrive all at once.
    onProxyRes(proxyRes) {
      proxyRes.headers["cache-control"] = proxyRes.headers["cache-control"] || "no-store";
    },
    onError(err, req, res) {
      // Answer in the API's own shape so the client's error handling still works.
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: `Dev proxy could not reach ${TARGET}: ${err.message}` }));
    }
  });

  // Every backend surface the frontend talks to. Anything not listed here is
  // served by the dev server as a static file, which is what we want.
  ["/api", "/auth", "/chat-stream", "/new-chat", "/switch-chat",
   "/reply-to-advisor", "/upload-document"].forEach(path => app.use(path, proxy));
};
