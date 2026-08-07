/**
 * Clients whose MCP servers can also live as Connectors in the vendor's
 * account, where Edison Watch cannot see or proxy them.
 *
 * A **presentation grouping, not a capability**. Whether Edison can configure a
 * client is `manageable`, which the daemon declares; this set is the separate
 * question of whether a client has a second, invisible place to keep servers.
 * The two overlap without being the same:
 *
 *   Claude Desktop / Cowork   manageable, connector-backed   local servers proxied,
 *                                                            Connectors invisible
 *   ChatGPT                   unmanageable, connector-backed  nothing proxied
 *
 * Hardcoded because the daemon has no notion of Connectors: it reports what it
 * can read on disk, and a server held in someone's OpenAI or Anthropic account
 * leaves no trace there. Promoting this to a daemon-reported fact would need a
 * coverage model richer than one boolean - see the discussion on PR #30.
 *
 * What this set shares between surfaces is **membership only**, not wording:
 * `AppsStep` puts these clients under one warning banner, `ClientsView` gives
 * each its own row state. The copy diverges by design - the manageable members
 * take `CONNECTOR_CAVEAT` below, while ChatGPT keeps its own wording in
 * `ClientsView` because nothing of its is proxied. Keep the ids here so the two
 * surfaces cannot disagree about who belongs in the group.
 */
export const CONNECTOR_BACKED_CLIENT_IDS: ReadonlySet<string> = new Set([
  "claude-desktop",
  "claude-cowork",
  "chatgpt",
]);

/**
 * Row and tooltip copy for a connector-backed client that Edison *can*
 * configure. Deliberately different from ChatGPT's wording: Edison really does
 * proxy these clients' local servers, so telling the user nothing is protected
 * would be false and would push them to go looking for a problem that isn't
 * there. The caveat is narrower - it is only the account-side Connectors that
 * are out of reach.
 */
export const CONNECTOR_CAVEAT = {
  row: "Local MCP servers are protected - account Connectors are not visible to Edison Watch",
  tooltip:
    "Edison Watch proxies this app's local MCP servers. It cannot see or " +
    "proxy Connectors held in your account - remove those manually and " +
    "request equivalents from your admin.",
} as const;
