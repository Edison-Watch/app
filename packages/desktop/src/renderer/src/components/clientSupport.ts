/**
 * Clients whose MCP servers can also live as Connectors in the vendor's
 * account, where SealGate cannot see or proxy them - and the copy each one
 * gets when that is the most important thing to say about it.
 *
 * A **presentation grouping, not a capability**. Whether SealGate can configure a
 * client is `manageable`, which the daemon declares; this is the separate
 * question of whether a client has a second, invisible place to keep servers.
 * Every member happens to be unmanageable today, for two different reasons:
 *
 *   ChatGPT                   every server is a Connector - nothing local at all
 *   Claude Desktop / Cowork   local servers exist, but `claude_desktop_config.json`
 *                             accepts stdio entries only, so a gateway URL has
 *                             no place to go; Connectors are the only route in
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
 * generic "SealGate can't configure this app", which says nothing about
 * what the user should do instead.
 *
 * The wording still differs per client, which is why this is a map rather than
 * one shared string. `AppsStep` uses membership alone, for its warning banner.
 */
export interface UnmanageableReason {
  row: string;
  tooltip: string;
}

/**
 * Copy for the Claude hosts. Deliberately unlike ChatGPT's below: those apps do
 * run local MCP servers, so "everything lives in your account" would be false.
 * What is true is narrower - SealGate has no way to *install* itself, because the
 * config file takes stdio entries only.
 *
 * It names the manual route, because unlike ChatGPT's case there is one that
 * fully works: adding the gateway as a custom connector proxies the same
 * servers SealGate would have proxied itself.
 */
const CONNECTOR_CAVEAT: UnmanageableReason = {
  row: "Add SealGate as a connector - this app can't be configured automatically",
  tooltip:
    "This app only accepts local commands in its config file, so SealGate " +
    "cannot install itself. Add the gateway under Settings > " +
    "Connectors to route this app's servers through it.",
};

const CONNECTOR_BACKED = {
  "claude-desktop": CONNECTOR_CAVEAT,
  "claude-cowork": CONNECTOR_CAVEAT,
  // No manual route offered here, because adding the gateway would not help:
  // every one of this client's servers lives in the account, so there is
  // nothing local for it to carry.
  chatgpt: {
    row: "Connectors are managed in your account - SealGate can't proxy them",
    tooltip:
      "This app's MCP servers are Connectors held in your account, not local " +
      "config SealGate can proxy. Remove them and request equivalents from " +
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
