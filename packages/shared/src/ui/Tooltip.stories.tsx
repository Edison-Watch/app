import type { Meta, StoryObj } from "@storybook/react-vite";
import Tooltip from "./Tooltip";
import Button from "./Button";

const meta: Meta<typeof Tooltip> = {
  title: "UI/Tooltip",
  component: Tooltip,
  argTypes: {
    placement: {
      control: "select",
      options: ["top", "bottom", "left", "right"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const Top: Story = {
  args: {
    content: "This is a tooltip",
    placement: "top",
    children: <Button variant="secondary">Hover me</Button>,
  },
};

export const Bottom: Story = {
  args: {
    content: "Bottom tooltip",
    placement: "bottom",
    children: <Button variant="secondary">Hover me</Button>,
  },
};

export const Left: Story = {
  args: {
    content: "Left tooltip",
    placement: "left",
    children: <Button variant="secondary">Hover me</Button>,
  },
};

export const Right: Story = {
  args: {
    content: "Right tooltip",
    placement: "right",
    children: <Button variant="secondary">Hover me</Button>,
  },
};

export const AllPlacements: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 24, padding: 60 }}>
      <Tooltip content="Top" placement="top">
        <Button variant="ghost">Top</Button>
      </Tooltip>
      <Tooltip content="Bottom" placement="bottom">
        <Button variant="ghost">Bottom</Button>
      </Tooltip>
      <Tooltip content="Left" placement="left">
        <Button variant="ghost">Left</Button>
      </Tooltip>
      <Tooltip content="Right" placement="right">
        <Button variant="ghost">Right</Button>
      </Tooltip>
    </div>
  ),
};

export const RichContent: Story = {
  args: {
    content: (
      <span>
        Press <kbd style={{ padding: "1px 4px", background: "var(--bg-overlay)", borderRadius: 3 }}>Esc</kbd> to close
      </span>
    ),
    placement: "top",
    children: <Button variant="secondary">Rich tooltip</Button>,
  },
};
