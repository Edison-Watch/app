import type { Meta, StoryObj } from "@storybook/react-vite";
import Select from "./Select";

const meta: Meta<typeof Select> = {
  title: "UI/Select",
  component: Select,
};

export default meta;
type Story = StoryObj<typeof Select>;

const statusOptions = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

export const Default: Story = {
  args: {
    options: statusOptions,
    placeholder: "Select status...",
  },
};

export const WithDefaultValue: Story = {
  args: {
    options: statusOptions,
    defaultValue: "active",
  },
};

export const Searchable: Story = {
  args: {
    options: [
      { value: "us-east", label: "US East" },
      { value: "us-west", label: "US West" },
      { value: "eu-central", label: "EU Central" },
      { value: "eu-west", label: "EU West" },
      { value: "ap-south", label: "AP South" },
      { value: "ap-northeast", label: "AP Northeast" },
    ],
    searchable: true,
    placeholder: "Search regions...",
  },
};

export const WithDisabledOptions: Story = {
  args: {
    options: [
      { value: "admin", label: "Admin" },
      { value: "user", label: "User" },
      { value: "owner", label: "Owner", disabled: true },
    ],
    placeholder: "Select role...",
  },
};

export const Disabled: Story = {
  args: {
    options: statusOptions,
    defaultValue: "active",
    disabled: true,
  },
};

export const AsyncOptions: Story = {
  args: {
    searchable: true,
    placeholder: "Search agents...",
    loadOptions: async (search: string) => {
      await new Promise((r) => setTimeout(r, 500));
      const agents = [
        { value: "code-review", label: "code-review-bot" },
        { value: "deploy", label: "deploy-agent" },
        { value: "security", label: "security-scanner" },
        { value: "test-runner", label: "test-runner" },
      ];
      return agents.filter((a) =>
        a.label.toLowerCase().includes(search.toLowerCase()),
      );
    },
  },
};
