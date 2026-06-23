/**
 * Agent bypass animation (side-by-side comparison).
 *
 * Composes two standalone panels that illustrate why traditional access
 * control fails for AI agents:
 *   - {@link HumanAccessAnimation}: a human user authenticates through
 *     an SSO/RBAC mesh wall and reaches the data store.
 *   - {@link AgentBypassPathAnimation}: AI agents skip the wall and
 *     reach the same data via an unmonitored over-the-wall path.
 *
 * Renders side-by-side on `md` and wider screens, and stacks vertically
 * on narrower (mobile) viewports.
 */

import AgentBypassPathAnimation from "./AgentBypassPathAnimation";
import HumanAccessAnimation from "./HumanAccessAnimation";

export default function AgentBypassAnimation(): React.ReactNode {
  return (
    <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-2">
      <HumanAccessAnimation />
      <AgentBypassPathAnimation />
    </div>
  );
}
