import type { Preview } from '@storybook/react-vite';
import React from 'react';
import '../src/renderer/src/assets/main.css';
import { installMockApi } from '../src/renderer/src/testing/mockApi';

// ── Mock window.api (Electron IPC) ───────────────────────────────────────────
//
// In Storybook, the Electron preload script does not run, so window.api is
// undefined. The stub is shared with the jsdom render tests (see
// renderer/src/testing/mockApi.ts) so the two can't drift: a namespace missing
// here throws inside a component effect and the story renders blank, which a
// visual diff catches long after the change that caused it.
//
installMockApi();

// Mock Date.now() for deterministic visual snapshots
const MOCK_TIMESTAMP = new Date('2025-01-15T12:00:00Z').getTime();
Date.now = () => MOCK_TIMESTAMP;

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: 'todo',
    },
    backgrounds: {
      disable: true,
    },
  },
  decorators: [
    (Story) => (
      <div
        data-theme="dark"
        style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)', padding: '1.5rem' }}
      >
        <Story />
      </div>
    ),
  ],
};

export default preview;
