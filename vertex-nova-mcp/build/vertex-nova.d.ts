/**
 * Vertex Nova API client.
 *
 * Talks to the Vertex Nova web dashboard at https://192.168.2.153:3080/api/chat.
 * Self-signed cert → TLS verification is disabled for local network calls.
 */
export interface VertexNovaResponse {
    response: string;
}
/**
 * Send a message to Vertex Nova's chat API.
 * Always prefixes with the agent identity marker.
 */
export declare function sendMessage(message: string, callerAgent?: string): Promise<string>;
/**
 * Check if Vertex Nova is reachable.
 */
export declare function healthCheck(): Promise<boolean>;
