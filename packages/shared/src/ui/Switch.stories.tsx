import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import Switch from "./Switch";

const meta: Meta<typeof Switch> = {
  title: "UI/Switch",
  component: Switch,
  argTypes: {
    disabled: { control: "boolean" },
    loading: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof Switch>;

export const Default: Story = {
  render: () => {
    const [checked, setChecked] = useState(false);
    return <Switch checked={checked} onChange={setChecked} label="Enable notifications" />;
  },
};

export const Checked: Story = {
  render: () => {
    const [checked, setChecked] = useState(true);
    return <Switch checked={checked} onChange={setChecked} label="Dark mode" />;
  },
};

export const Disabled: Story = {
  args: { checked: false, onChange: () => {}, label: "Disabled switch", disabled: true },
};

export const DisabledChecked: Story = {
  args: { checked: true, onChange: () => {}, label: "Disabled (on)", disabled: true },
};

export const Loading: Story = {
  args: { checked: false, onChange: () => {}, label: "Saving...", loading: true },
};

export const WithoutLabel: Story = {
  render: () => {
    const [checked, setChecked] = useState(false);
    return <Switch checked={checked} onChange={setChecked} />;
  },
};
