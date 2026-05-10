/**
 * Thin wrapper around the OpenAI REST API (Responses + Files) used by every
 * non-Realtime Edge Function. The key lives in the `openai_realtime2`
 * Edge-Function secret and never leaves the server.
 *
 * - `callResponses` posts to `/v1/responses` with a JSON-Schema structured
 *   output and parses the model's response into the typed shape the caller
 *   asked for. We retry once on 5xx so transient OpenAI hiccups don't fail
 *   the whole pipeline.
 * - `uploadFileToOpenAI` posts to `/v1/files` with `purpose=user_data` so we
 *   can reference the resulting `file_id` in a Responses call (`input_file`).
 */

declare const Deno: { env: { get(key: string): string | undefined } };

export const OPENAI_KEY_NAME = "openai_realtime2";

export const DEFAULT_MODELS = {
  parse: "gpt-4.1-mini",
  analyze: "gpt-4.1-mini",
  plan: "gpt-4.1-mini",
  score: "gpt-4.1",
} as const;

export class OpenAIError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.status = status;
    this.body = body;
    this.name = "OpenAIError";
  }
}

export function getOpenAIKey(): string {
  const key = Deno.env.get(OPENAI_KEY_NAME);
  if (!key) {
    throw new OpenAIError(
      `missing_secret_${OPENAI_KEY_NAME}`,
      500,
      `Edge Function secret \`${OPENAI_KEY_NAME}\` is not set.`,
    );
  }
  return key;
}

/** Content parts accepted by the Responses API user/system messages. */
export type ResponsesContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_file"; file_id: string }
  | { type: "input_image"; image_url: string };

export interface ResponsesMessage {
  role: "system" | "user" | "assistant";
  content: ResponsesContentPart[];
}

export interface CallResponsesArgs<T> {
  model?: string;
  input: ResponsesMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  temperature?: number;
  /** Plain-language label for logs. */
  operation?: string;
}

interface ResponsesApiResponse {
  id?: string;
  output?: Array<{
    type?: string;
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
      // Some SDKs expose pre-parsed structured output here.
      parsed?: unknown;
    }>;
  }>;
  output_text?: string;
  output_parsed?: unknown;
  error?: { message?: string };
}

/**
 * Calls the Responses API once (with one retry on 5xx) using a strict
 * JSON-Schema structured output. The schema must have `type: "object"`,
 * `additionalProperties: false`, and list every property in `required` —
 * these are OpenAI's own constraints for guaranteed JSON.
 */
export async function callResponses<T>(args: CallResponsesArgs<T>): Promise<T> {
  const key = getOpenAIKey();
  const model = args.model ?? DEFAULT_MODELS.analyze;
  const body = {
    model,
    input: args.input,
    text: {
      format: {
        type: "json_schema",
        name: args.schemaName,
        strict: true,
        schema: args.schema,
      },
    },
    temperature: args.temperature,
  };

  let lastErr: { status: number; text: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (r.ok) {
      const json = (await r.json()) as ResponsesApiResponse;
      const parsed = extractParsedJson(json);
      if (parsed === undefined) {
        throw new OpenAIError(
          "openai_responses_no_output",
          502,
          JSON.stringify(json).slice(0, 600),
        );
      }
      return parsed as T;
    }

    const text = await r.text().catch(() => "");
    lastErr = { status: r.status, text };
    if (r.status < 500) break;
    await new Promise((res) => setTimeout(res, 600));
  }

  throw new OpenAIError(
    `openai_responses_${lastErr?.status ?? "unknown"}`,
    lastErr?.status ?? 502,
    (lastErr?.text ?? "").slice(0, 600),
  );
}

/**
 * Extracts the structured JSON from a Responses API result. The API has a
 * few different shapes depending on SDK version; we try each in turn.
 */
function extractParsedJson(res: ResponsesApiResponse): unknown {
  if (res.output_parsed !== undefined) return res.output_parsed;

  if (Array.isArray(res.output)) {
    for (const item of res.output) {
      if (!item?.content) continue;
      for (const part of item.content) {
        if (part.parsed !== undefined) return part.parsed;
        if (typeof part.text === "string" && part.text.trim().length > 0) {
          try {
            return JSON.parse(part.text);
          } catch {
            // Fall through; another part might be valid.
          }
        }
      }
    }
  }

  if (typeof res.output_text === "string" && res.output_text.trim().length > 0) {
    try {
      return JSON.parse(res.output_text);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/**
 * Uploads a binary file to OpenAI Files API. We use `purpose=user_data` so
 * the file can be referenced as an `input_file` part in Responses API
 * requests (PDF document understanding).
 */
export async function uploadFileToOpenAI(
  blob: Blob,
  filename: string,
): Promise<string> {
  const key = getOpenAIKey();
  const form = new FormData();
  form.set("purpose", "user_data");
  form.set("file", blob, filename);

  const r = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new OpenAIError(
      `openai_files_${r.status}`,
      r.status,
      text.slice(0, 600),
    );
  }

  const json = (await r.json()) as { id?: string };
  if (!json.id) {
    throw new OpenAIError(
      "openai_files_no_id",
      502,
      JSON.stringify(json).slice(0, 600),
    );
  }
  return json.id;
}
