import type { Meta, StoryObj } from "@storybook/react-vite";
import Badge from "./Badge";

const meta: Meta<typeof Badge> = {
  title: "UI/Badge",
  component: Badge,
  argTypes: {
    variant: {
      control: "select",
      options: ["success", "warning", "danger", "info", "neutral", "blocked"],
    },
    size: { control: "select", options: ["sm", "md"] },
  },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Success: Story = {
  args: { variant: "success", children: "Active" },
};
export const Warning: Story = {
  args: { variant: "warning", children: "Pending" },
};
export const Danger: Story = { args: { variant: "danger", children: "Error" } };
export const Info: Story = { args: { variant: "info", children: "Info" } };
export const Neutral: Story = {
  args: { variant: "neutral", children: "Default" },
};
export const Blocked: Story = {
  args: { variant: "blocked", children: "Blocked" },
};

export const Small: Story = {
  args: { variant: "success", size: "sm", children: "Small" },
};
export const Medium: Story = {
  args: { variant: "success", size: "md", children: "Medium" },
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Badge variant="success">Success</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="danger">Danger</Badge>
      <Badge variant="info">Info</Badge>
      <Badge variant="neutral">Neutral</Badge>
      <Badge variant="blocked">Blocked</Badge>
    </div>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <Badge variant="info" size="sm">
        Small
      </Badge>
      <Badge variant="info" size="md">
        Medium
      </Badge>
    </div>
  ),
};
