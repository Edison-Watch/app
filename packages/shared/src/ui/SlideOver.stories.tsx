import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import SlideOver from "./SlideOver";
import Button from "./Button";

const meta: Meta<typeof SlideOver> = {
  title: "UI/SlideOver",
  component: SlideOver,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof SlideOver>;

export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <div style={{ padding: 40 }}>
        <Button onClick={() => setOpen(true)}>Open SlideOver</Button>
        <SlideOver
          open={open}
          onClose={() => setOpen(false)}
          title="Session Details"
        >
          <div
            style={{
              color: "var(--text-secondary)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <p>Agent: code-review-bot</p>
            <p>Duration: 12.4s</p>
            <p>Status: Completed</p>
            <p>Tool Calls: 5</p>
          </div>
        </SlideOver>
      </div>
    );
  },
};

export const WithFooter: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <div style={{ padding: 40 }}>
        <Button onClick={() => setOpen(true)}>Open with Footer</Button>
        <SlideOver
          open={open}
          onClose={() => setOpen(false)}
          title="Edit Policy"
          footer={
            <div
              style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}
            >
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setOpen(false)}>
                Save
              </Button>
            </div>
          }
        >
          <div style={{ color: "var(--text-secondary)" }}>
            <p>Policy configuration content goes here.</p>
          </div>
        </SlideOver>
      </div>
    );
  },
};
