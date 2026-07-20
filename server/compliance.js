// Shared compliance instruction for any AI-generated, user-facing text in the app.
// Per product spec: no direct buy/sell/hold recommendations unless a compliance
// review route has been cleared (not yet built) — so every AI prompt that touches
// user-facing copy must include this.
const COMPLIANCE_INSTRUCTION = `
COMPLIANCE RULE (must follow exactly): Do NOT use the words "buy", "sell", or "hold" as
recommendations, and do not tell the user what action to take with a specific position.
You may describe what happened and why, and explain risk factors and context, but frame
everything as informational/educational — never as a directive to trade. This is a hard
compliance requirement, not a style preference.`;

module.exports = { COMPLIANCE_INSTRUCTION };