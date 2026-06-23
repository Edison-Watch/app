import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import Dialog from "./Dialog";
import Button from "./Button";

const meta: Meta<typeof Dialog> = {
  title: "UI/Dialog",
  component: Dialog,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof Dialog>;

export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <div style={{ padding: 40 }}>
        <Button onClick={() => setOpen(true)}>Open Dialog</Button>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="Confirm Action"
        >
          <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
            Are you sure you want to proceed? This action cannot be undone.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => setOpen(false)}>
              Delete
            </Button>
          </div>
        </Dialog>
      </div>
    );
  },
};

export const WithoutTitle: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <div style={{ padding: 40 }}>
        <Button onClick={() => setOpen(true)}>Open Dialog</Button>
        <Dialog open={open} onClose={() => setOpen(false)}>
          <p style={{ color: "var(--text-primary)", marginBottom: 16 }}>
            A simple dialog without a title.
          </p>
          <Button variant="primary" onClick={() => setOpen(false)}>
            OK
          </Button>
        </Dialog>
      </div>
    );
  },
};

export const OpenByDefault: Story = {
  args: {
    open: true,
    onClose: () => {},
    title: "Static Dialog",
    children: (
      <p style={{ color: "var(--text-secondary)" }}>
        This dialog is open for demonstration. Click the backdrop or press Esc
        to close.
      </p>
    ),
  },
};
