// Validates the request body and normalises the history for Gemini.
//
// Expected body:  { "messages": [ { "role": "user" | "assistant", "content": "..." }, ... ] }
// The last message must be from the user. Unknown fields are ignored (never forwarded).

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function fail(code, message, status = 400) {
  return { ok: false, status, code, message };
}

export function validateBody(body, cfg) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail("invalid_body", "Body must be a JSON object.");
  }
  const raw = body.messages;
  if (!Array.isArray(raw) || raw.length === 0) {
    return fail("invalid_messages", "`messages` must be a non-empty array.");
  }
  if (raw.length > cfg.maxMessagesAccepted) {
    return fail("too_many_messages", `At most ${cfg.maxMessagesAccepted} messages are accepted.`);
  }

  const cleaned = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") return fail("invalid_message", "Each message must be an object.");
    const role = m.role === "model" ? "assistant" : m.role;
    if (role !== "user" && role !== "assistant") {
      return fail("invalid_role", "Message role must be 'user' or 'assistant'.");
    }
    if (typeof m.content !== "string") return fail("invalid_content", "Message content must be a string.");
    const content = m.content.replace(CONTROL_CHARS, "").trim();
    if (content.length > cfg.maxMessageChars) {
      return fail("message_too_long", `A message exceeds ${cfg.maxMessageChars} characters.`, 413);
    }
    if (content) cleaned.push({ role, content });
  }

  // Keep the newest N, then shape for Gemini: alternate roles, start with the user.
  const recent = cleaned.slice(-cfg.historyKept);
  const contents = [];
  for (const m of recent) {
    const role = m.role === "user" ? "user" : "model";
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += "\n" + m.content;
    else contents.push({ role, parts: [{ text: m.content }] });
  }
  while (contents.length && contents[0].role !== "user") contents.shift();

  const last = contents[contents.length - 1];
  if (!last || last.role !== "user") {
    return fail("last_not_user", "The last message must come from the user.");
  }
  const lastCleaned = cleaned[cleaned.length - 1];
  if (lastCleaned.content.length > cfg.maxLastUserChars) {
    return fail("message_too_long", `Your message exceeds ${cfg.maxLastUserChars} characters.`, 413);
  }
  return { ok: true, contents };
}
