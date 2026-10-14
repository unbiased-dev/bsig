import { defineConfig } from "vite";
import bsig from "bsig/plugin";

export default defineConfig({
  plugins: [bsig()],
  esbuild: {
    jsx: "automatic",
  },
});
