import type { StorybookConfig } from "@storybook/react-vite";
import { dirname } from "path";
import { fileURLToPath } from "url";

function getAbsolutePath(value: string) {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}

const config: StorybookConfig = {
  stories: [
    "../src/ui/**/*.stories.@(ts|tsx)",
    "../src/animations/**/*.stories.@(ts|tsx)",
  ],
  addons: [
    getAbsolutePath("@storybook/addon-docs"),
    getAbsolutePath("@storybook/addon-onboarding"),
    getAbsolutePath("@chromatic-com/storybook"),
  ],
  framework: getAbsolutePath("@storybook/react-vite"),
  viteFinal: (config) => {
    config.css = { ...config.css, postcss: {} };
    return config;
  },
};

export default config;
