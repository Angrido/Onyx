const apiUrl = process.env["ONYX_API_URL"];
const token = process.env["ONYX_RUN_TOKEN"];
const FALLBACK = "Onyx";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function report(payload: string): Promise<string> {
  if (!apiUrl || !token) return FALLBACK;
  try {
    const response = await fetch(`${apiUrl}/internal/hooks/statusline`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: payload.length > 0 ? payload : "{}",
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return FALLBACK;
    const body = (await response.json()) as { text?: unknown };
    return typeof body.text === "string" && body.text.length > 0 ? body.text : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

process.stdout.write(`${await report(await readStdin())}\n`);
