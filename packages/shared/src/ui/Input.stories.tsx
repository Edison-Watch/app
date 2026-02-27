import type { Meta, StoryObj } from "@storybook/react-vite";
import Input from "./Input";

const meta: Meta<typeof Input> = {
  title: "UI/Input",
  component: Input,
  argTypes: {
    type: { control: "select", options: ["text", "password", "search"] },
  },
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Text: Story = {
  args: { type: "text", label: "Username", placeholder: "Enter username" },
};

export const Password: Story = {
  args: { type: "password", label: "Password", placeholder: "Enter password" },
};

export const Search: Story = {
  args: { type: "search", placeholder: "Search sessions..." },
};

export const WithDescription: Story = {
  args: {
    type: "text",
    label: "API Key",
    description: "Your API key is used to authenticate requests.",
    placeholder: "sk-...",
  },
};

export const WithError: Story = {
  args: {
    type: "text",
    label: "Email",
    error: "Please enter a valid email address.",
    placeholder: "user@example.com",
  },
};

export const WithLabelAndError: Story = {
  args: {
    type: "password",
    label: "Password",
    description: "Must be at least 8 characters.",
    error: "Password is too short.",
  },
};

export const AllTypes: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, width: 300 }}>
      <Input type="text" label="Text Input" placeholder="Type here..." />
      <Input type="password" label="Password Input" placeholder="Enter password" />
      <Input type="search" label="Search Input" placeholder="Search..." />
    </div>
  ),
};
