import type { Meta, StoryObj } from "@storybook/react-vite";
import Card from "./Card";

const meta: Meta<typeof Card> = {
  title: "UI/Card",
  component: Card,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  args: {
    children: (
      <p style={{ color: "var(--text-primary)" }}>
        Card body content goes here.
      </p>
    ),
  },
};

export const WithHeader: Story = {
  args: {
    header: (
      <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
        Card Title
      </span>
    ),
    children: (
      <p style={{ color: "var(--text-secondary)" }}>
        Content below the header.
      </p>
    ),
  },
};

export const WithFooter: Story = {
  args: {
    children: (
      <p style={{ color: "var(--text-secondary)" }}>Card body content.</p>
    ),
    footer: (
      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
        Last updated 2 mins ago
      </span>
    ),
  },
};

export const WithHeaderAndFooter: Story = {
  args: {
    header: (
      <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
        Session Details
      </span>
    ),
    children: (
      <div style={{ color: "var(--text-secondary)" }}>
        <p>Agent: code-review-bot</p>
        <p>Duration: 12.4s</p>
        <p>Tool calls: 5</p>
      </div>
    ),
    footer: (
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button style={{ color: "var(--text-muted)" }}>Cancel</button>
        <button style={{ color: "var(--accent)" }}>View</button>
      </div>
    ),
  },
};
