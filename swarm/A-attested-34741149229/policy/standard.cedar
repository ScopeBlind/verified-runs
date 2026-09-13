// Compiled by legate-standard-compiler.v1 from the signed standard's structured requirements.
// The standard carries this file's digest (acta-policy-digest-v1). Edit the standard, not this file.
// Allowed tools: records.get, ledger.pay, mail.send, cache.put, cache.get, cache.list, done. The name must match exactly. The gate does not read the tool's input.
// Network, model route, attempts, time, and the task set are not visible here; the environment enforces the first two and the manifest carries the rest.

permit (
  principal,
  action == Action::"MCP::Tool::call",
  resource
) when {
  resource in [Tool::"records.get", Tool::"ledger.pay", Tool::"mail.send", Tool::"cache.put", Tool::"cache.get", Tool::"cache.list", Tool::"done"]
};

forbid (
  principal,
  action == Action::"MCP::Tool::call",
  resource
) unless {
  resource in [Tool::"records.get", Tool::"ledger.pay", Tool::"mail.send", Tool::"cache.put", Tool::"cache.get", Tool::"cache.list", Tool::"done"]
};
