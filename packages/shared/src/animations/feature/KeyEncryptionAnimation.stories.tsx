import type { Meta, StoryObj } from "@storybook/react-vite";
import KeyEncryptionAnimation from "./KeyEncryptionAnimation";

const meta: Meta<typeof KeyEncryptionAnimation> = {
  title: "Animations/KeyEncryptionAnimation",
  component: KeyEncryptionAnimation,
  parameters: {
    layout: "centered",
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  decorators: [
    (Story) => (
      <div style={{ padding: "24px", background: "var(--bg-base)" }}>
        <Story />
      </div>
    ),
  ],
};

export const LightTheme: Story = {
  decorators: [
    (Story) => (
      <div
        data-theme="light"
        style={{ padding: "24px", background: "#f8fafc" }}
      >
        <Story />
      </div>
    ),
  ],
};
