/**
 * Stream-mode resolution for the chat path.
 *
 * A client that omits `stream` is asking for a single JSON response, not a
 * stream. The previous inline logic (`body.stream !== false`) defaulted to
 * streaming, which forced every OpenAI-compatible provider that replies with a
 * plain JSON body down the SSE path. No usage block is ever parsed there, so
 * post-request billing silently charged nothing.
 *
 * Extracted so the rule is testable and reusable.
 */
import { FORMATS } from "../translator/formats.js";

/** Providers whose upstream API only works in streaming mode. */
export const STREAM_REQUIRED_PROVIDERS = new Set(["openai", "codex", "commandcode"]);

/** Client formats that are natively streaming and never send an explicit flag. */
const IMPLICITLY_STREAMING_FORMATS = new Set([
  FORMATS.ANTIGRAVITY,
  FORMATS.GEMINI,
  FORMATS.GEMINI_CLI,
]);

export function resolveStreamFlags({ body, provider, sourceFormat }) {
  const clientRequestedStreaming =
    body.stream === true || IMPLICITLY_STREAMING_FORMATS.has(sourceFormat);

  const providerRequiresStreaming = STREAM_REQUIRED_PROVIDERS.has(provider);

  // Omitted flag means "not streaming" — only an explicit true opts in.
  const stream = providerRequiresStreaming ? true : body.stream === true;

  return { clientRequestedStreaming, providerRequiresStreaming, stream };
}
