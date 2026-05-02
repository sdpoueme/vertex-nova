/**
 * Vertex Nova MCP Tools
 *
 * Privacy-aware tools for interacting with Vertex Nova.
 * These tools enforce the privacy wall:
 * - No financial data (amounts, account numbers) should pass through
 * - Only directional operational signals
 * - Agent identity is always declared
 *
 * Human users of Vertex Nova: Serge Poueme and Stéphanie Djomgoue.
 * All MCP traffic is clearly identified as automated agent traffic.
 */
import { z } from "zod";
import { sendMessage, healthCheck } from "./vertex-nova.js";
// Privacy guardrails — reject messages containing financial data patterns
const FINANCIAL_PATTERNS = [
    /\$\s*\d+[.,]\d{2}/, // Dollar amounts like $83.92
    /\d+[.,]\d{2}\s*\$/, // Amounts like 83,92 $
    /(?:account|compte)\s*#?\s*\d{4,}/i, // Account numbers
    /\b\d{4}[\s-]\d{4}[\s-]\d{4}\b/, // Card numbers
    /balance[:\s]+\$?\d/i, // Balance mentions with amounts
    /(?:salary|salaire|revenu|income|dette|debt)\b/i, // Financial terms
    /(?:mortgage|hypothèque|prêt|loan|crédit)\s+\$?\d/i, // Loan amounts
];
function containsFinancialData(text) {
    return FINANCIAL_PATTERNS.some((pattern) => pattern.test(text));
}
const CallerAgent = z
    .string()
    .default("Amazon Quick — Home Maintenance Planner")
    .describe("Identity of the calling agent. Will be prefixed to all messages sent to Vertex Nova.");
export function registerTools(server) {
    // ── Health Check ──────────────────────────────────────────────────
    server.tool("vertex_health", "Check if Vertex Nova is online and responding", {}, async () => {
        const ok = await healthCheck();
        return {
            content: [
                {
                    type: "text",
                    text: ok
                        ? "✅ Vertex Nova is online and healthy"
                        : "❌ Vertex Nova is unreachable at " +
                            (process.env.VERTEX_NOVA_URL || "https://192.168.2.153:3080"),
                },
            ],
        };
    });
    // ── Chat (general-purpose, privacy-filtered) ──────────────────────
    server.tool("vertex_chat", "Send a message to Vertex Nova. The message is automatically prefixed with your agent identity. PRIVACY: Do NOT include dollar amounts, account numbers, balances, or any financial data — the message will be rejected.", {
        message: z
            .string()
            .describe("Message to send to Vertex Nova. Must be directional/operational only — no financial data."),
        caller_agent: CallerAgent,
    }, async ({ message, caller_agent }) => {
        if (containsFinancialData(message)) {
            return {
                content: [
                    {
                        type: "text",
                        text: "🚫 PRIVACY WALL: Message rejected — contains financial data (dollar amounts, account numbers, or financial terms with amounts). Rephrase using directional language only (e.g., 'gas consumption appears elevated' instead of 'gas bill was $83.92').",
                    },
                ],
                isError: true,
            };
        }
        try {
            const response = await sendMessage(message, caller_agent);
            return { content: [{ type: "text", text: response }] };
        }
        catch (err) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error communicating with Vertex Nova: ${err instanceof Error ? err.message : String(err)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // ── Energy Investigation ──────────────────────────────────────────
    server.tool("vertex_investigate_energy", "Ask Vertex Nova to investigate energy consumption patterns. Use when a utility bill exceeds budget. PRIVACY: Do NOT include actual bill amounts — only indicate direction (elevated, normal, reduced).", {
        utility: z
            .enum(["electricity", "gas", "both"])
            .describe("Which utility to investigate"),
        direction: z
            .enum(["elevated", "significantly_elevated", "reduced", "normal"])
            .describe("Direction of the anomaly vs seasonal norms"),
        period: z
            .string()
            .optional()
            .describe("Time period to investigate (e.g., 'past 2 weeks', 'April', 'last month')"),
        caller_agent: CallerAgent,
    }, async ({ utility, direction, period, caller_agent }) => {
        const utilityLabel = utility === "electricity"
            ? "electricity (Hydro-Québec)"
            : utility === "gas"
                ? "natural gas (Énergir)"
                : "electricity and natural gas";
        const periodStr = period ? ` over the ${period}` : "";
        const directionStr = direction === "elevated"
            ? "appears elevated compared to seasonal norms"
            : direction === "significantly_elevated"
                ? "is significantly elevated compared to seasonal norms — please investigate urgently"
                : direction === "reduced"
                    ? "appears lower than expected"
                    : "appears within normal range — no investigation needed";
        const message = `Home energy check: ${utilityLabel} consumption ${directionStr}${periodStr}. Can you check HVAC runtime, thermostat scheduling, presence detection patterns, and any device-level consumption data to identify the cause? Please provide specific findings and recommendations.`;
        try {
            const response = await sendMessage(message, caller_agent);
            return { content: [{ type: "text", text: response }] };
        }
        catch (err) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // ── Security Investigation ────────────────────────────────────────
    server.tool("vertex_investigate_security", "Ask Vertex Nova to investigate security system patterns (e.g., system not armed, repeated alerts).", {
        issue: z
            .string()
            .describe("Description of the security pattern to investigate (e.g., 'system not armed at 11:15 AM on multiple days')"),
        frequency: z
            .string()
            .optional()
            .describe("How often this occurred (e.g., '10 times in 2 weeks', 'daily')"),
        caller_agent: CallerAgent,
    }, async ({ issue, frequency, caller_agent }) => {
        if (containsFinancialData(issue)) {
            return {
                content: [
                    {
                        type: "text",
                        text: "🚫 PRIVACY WALL: Message rejected — contains financial data.",
                    },
                ],
                isError: true,
            };
        }
        const freqStr = frequency ? ` This has occurred ${frequency}.` : "";
        const message = `Security system alert: ${issue}${freqStr} Can you check presence detection logs, arrival/departure patterns, and the auto-arm schedule to determine if this is expected behavior or if the arming schedule needs adjustment?`;
        try {
            const response = await sendMessage(message, caller_agent);
            return { content: [{ type: "text", text: response }] };
        }
        catch (err) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // ── Seasonal Optimization ─────────────────────────────────────────
    server.tool("vertex_seasonal_check", "Ask Vertex Nova to perform a seasonal readiness check and suggest optimizations for heating/cooling schedules.", {
        season: z
            .enum(["spring", "summer", "fall", "winter"])
            .describe("Current or approaching season"),
        request: z
            .string()
            .optional()
            .describe("Specific request (e.g., 'verify AC is operational', 'optimize heating schedule')"),
        caller_agent: CallerAgent,
    }, async ({ season, request, caller_agent }) => {
        const seasonTips = {
            spring: "Spring is here in Sainte-Julie. Can you verify the AC system is operational and suggest an initial cooling schedule? Also check if any smart home automations need seasonal adjustments (e.g., switching from heating to cooling mode, adjusting presence-based schedules).",
            summer: "Summer heat is here. Can you review the current AC schedule and optimize it for energy efficiency based on occupancy patterns? Check if any rooms are being cooled unnecessarily and suggest improvements.",
            fall: "Fall is approaching. Can you prepare the heating system — verify the furnace/heating is operational, suggest a winter heating schedule optimized for energy savings, and check if weather-based automations are configured?",
            winter: "Deep winter in Sainte-Julie. Can you review the current heating schedule for energy efficiency? Check humidity levels, monitor for any heating anomalies, and ensure night mode security is active.",
        };
        const base = seasonTips[season];
        const extra = request ? ` Additional request: ${request}` : "";
        try {
            const response = await sendMessage(base + extra, caller_agent);
            return { content: [{ type: "text", text: response }] };
        }
        catch (err) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // ── Device Status ─────────────────────────────────────────────────
    server.tool("vertex_device_status", "Ask Vertex Nova for a status report on smart home devices.", {
        category: z
            .enum(["all", "security", "climate", "lighting", "speakers", "sensors"])
            .optional()
            .default("all")
            .describe("Category of devices to check"),
        caller_agent: CallerAgent,
    }, async ({ category, caller_agent }) => {
        const catStr = category === "all" ? "all smart home devices" : `${category} devices`;
        const message = `Can you provide a status report for ${catStr}? Include: which devices are online/offline, any devices with low battery, any devices showing errors or unusual behavior, and any maintenance recommendations.`;
        try {
            const response = await sendMessage(message, caller_agent);
            return { content: [{ type: "text", text: response }] };
        }
        catch (err) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // ── Presence Report ───────────────────────────────────────────────
    server.tool("vertex_presence_report", "Ask Vertex Nova for presence detection patterns (who's home, arrival/departure trends). PRIVACY: This only reports presence data from network detection — no personal or financial information.", {
        period: z
            .string()
            .optional()
            .default("past week")
            .describe("Time period for the report (e.g., 'today', 'past week')"),
        caller_agent: CallerAgent,
    }, async ({ period, caller_agent }) => {
        const message = `Can you provide a presence detection summary for the ${period}? Include: typical arrival/departure patterns, any unusual patterns, and how this data could be used to optimize energy schedules.`;
        try {
            const response = await sendMessage(message, caller_agent);
            return { content: [{ type: "text", text: response }] };
        }
        catch (err) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
                    },
                ],
                isError: true,
            };
        }
    });
}
