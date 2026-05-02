/**
 * Vertex Nova API client.
 *
 * Talks to the Vertex Nova web dashboard at https://192.168.2.153:3080/api/chat.
 * Self-signed cert → TLS verification is disabled for local network calls.
 */
import https from "node:https";
import http from "node:http";
const VERTEX_NOVA_URL = process.env.VERTEX_NOVA_URL || "https://192.168.2.153:3080";
/**
 * Make an HTTP(S) request using Node's native modules.
 * Handles self-signed certs by disabling TLS verification.
 */
function request(url, options) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const isHttps = parsed.protocol === "https:";
        const lib = isHttps ? https : http;
        const reqOptions = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: options.method,
            headers: options.headers || {},
            rejectUnauthorized: false,
            // Disable TLS verification for self-signed certs
            ...(isHttps ? { agent: new https.Agent({ rejectUnauthorized: false }) } : {}),
        };
        const req = lib.request(reqOptions, (res) => {
            let data = "";
            res.on("data", (chunk) => {
                data += chunk.toString();
            });
            res.on("end", () => {
                resolve({ status: res.statusCode || 0, body: data });
            });
        });
        req.on("error", reject);
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}
/**
 * Send a message to Vertex Nova's chat API.
 * Always prefixes with the agent identity marker.
 */
export async function sendMessage(message, callerAgent = "Amazon Quick") {
    const prefixed = `[AUTOMATED AGENT: ${callerAgent}] ${message}`;
    const url = `${VERTEX_NOVA_URL}/api/chat`;
    const body = JSON.stringify({ message: prefixed });
    const response = await request(url, {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json" },
    });
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`Vertex Nova API error: ${response.status} — ${response.body.slice(0, 200)}`);
    }
    try {
        const data = JSON.parse(response.body);
        return data.response || "No response from Vertex Nova";
    }
    catch {
        return response.body || "No response from Vertex Nova";
    }
}
/**
 * Check if Vertex Nova is reachable.
 */
export async function healthCheck() {
    try {
        const url = `${VERTEX_NOVA_URL}/`;
        const response = await request(url, { method: "GET" });
        // Any HTTP response (even 404) means the server is alive
        return response.status > 0;
    }
    catch {
        return false;
    }
}
