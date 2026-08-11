/**
 * Clients whose MCP servers can also live as Connectors in the vendor's
 * account, where Edison Watch cannot see or proxy them - and the copy each one
 * gets when that is the most important thing to say about it.
 *
 * A **presentation grouping, not a capability**. Whether Edison can configure a
 * client is `manageable`, which the daemon declares; this is the separate
 * question of whether a client has a second, invisible place to keep servers.
 * The two overlap without being the same:
 *
 *   Claude Desktop / Cowork   manageable, connector-backed     local servers proxied,
 *                                                             Connectors invisible
 *   ChatGPT                   unmanageable, connector-backed   nothing proxied
 *
 * Hardcoded because the daemon has no notion of Connectors: it reports what it
 * can read on disk, and a server held in someone's OpenAI or Anthropic account
 * leaves no trace there. Promoting this to a daemon-reported fact would need a
 * coverage model richer than one boolean - see the discussion on PR #30.
 *
 * Membership and copy are ONE declaration on purpose. `ClientsView` routes on
 * membership - a fully set up member is downgraded out of "Connected" - and
 * then renders whatever the lookup returns for it. Split in two, adding an id
 * to the membership list and forgetting the copy list would fall through to the
 * generic "Edison Watch can't configure this app": a client Edison configures
 * perfectly well, labelled unconfigurable. That is the precise false message
 * this grouping exists to remove, so the two cannot be separated here.
 *
 * The wording still differs per client, which is why this is a map rather than
 * one shared string. `AppsStep` uses membership alone, for its warning banner.
 */
export interface UnmanageableReason {
  row: string;
  tooltip: string;
}

/**
 * Copy for a connector-backed client Edison *can* configure. Deliberately
 * unlike ChatGPT's below: Edison really does proxy these clients' local
 * servers, so telling the user nothing is protected would be false and would
 * send them hunting for a problem that isn't there. The caveat is narrower -
 * only the account-side Connectors are out of reach.
 */
const CONNECTOR_CAVEAT: UnmanageableReason = {
  row: "Local MCP servers are protected - account Connectors are not visible to Edison Watch",
  tooltip:
    "Edison Watch proxies this app's local MCP servers. It cannot see or " +
    "proxy Connectors held in your account - remove those manually and " +
    "request equivalents from your admin.",
};

const CONNECTOR_BACKED = {
  "claude-desktop": CONNECTOR_CAVEAT,
  "claude-cowork": CONNECTOR_CAVEAT,
  // No reassurance about local servers here, because there are none Edison can
  // reach: every one of this client's servers lives in the account.
  chatgpt: {
    row: "Connectors are managed in your account - Edison Watch can't proxy them",
    tooltip:
      "This app's MCP servers are Connectors held in your account, not local " +
      "config Edison Watch can proxy. Remove them and request equivalents from " +
      "your admin.",
  },
} satisfies Record<string, UnmanageableReason>;

/**
 * The lookup both surfaces use, for membership and for copy.
 *
 * A Map rather than the object literal above: the key is an id the daemon
 * chose, and an object lookup answers inherited keys as though they were
 * entries - a client named `constructor` would take a function where the
 * fallback belongs. `Object.entries` yields own enumerable keys only, so
 * nothing inherited reaches the Map.
 */
export const CONNECTOR_BACKED_REASON: ReadonlyMap<string, UnmanageableReason> = new Map(
  Object.entries(CONNECTOR_BACKED),
);
