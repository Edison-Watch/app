import type { Meta, StoryObj } from "@storybook/react-vite";
import { SkeletonText, SkeletonRect, SkeletonCircle, PageSkeleton } from "./Skeleton";

const meta: Meta = {
  title: "UI/Skeleton",
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj;

export const TextSkeleton: Story = {
  render: () => (
    <div style={{ width: 300, display: "flex", flexDirection: "column", gap: 8 }}>
      <SkeletonText />
      <SkeletonText />
      <SkeletonText className="w-3/4" />
    </div>
  ),
};

export const RectSkeleton: Story = {
  render: () => <SkeletonRect />,
};

export const CircleSkeleton: Story = {
  render: () => <SkeletonCircle />,
};

export const FullPageSkeleton: Story = {
  render: () => <PageSkeleton />,
};

export const CompositeLoading: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <SkeletonCircle />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        <SkeletonText />
        <SkeletonText className="w-2/3" />
      </div>
    </div>
  ),
};
