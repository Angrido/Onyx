import { McpToolResultSchema, type McpToolName, type McpToolResult } from "@onyx/contracts";

export interface ToolClient {
  call(tool: McpToolName, input: Record<string, unknown>): Promise<McpToolResult>;
}

export interface HttpToolClientOptions {
  apiUrl: string;
  token: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class HttpToolClient implements ToolClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpToolClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async call(tool: McpToolName, input: Record<string, unknown>): Promise<McpToolResult> {
    const response = await this.fetchImpl(
      `${this.options.apiUrl.replace(/\/+$/, "")}/internal/mcp/${tool}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      },
    );
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        payload !== null && typeof payload === "object" && "message" in payload
          ? String((payload as { message: unknown }).message)
          : `Onyx API answered ${response.status}`;
      return { text: message, tokens: 0, isError: true };
    }
    return McpToolResultSchema.parse(payload);
  }
}
