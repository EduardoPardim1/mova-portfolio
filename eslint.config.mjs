import nextPlugin from "@next/eslint-plugin-next";

export default [{
  ignores: [".next/**", ".next-dev/**", "node_modules/**", "coverage/**", "playwright-report/**"],
  plugins: { "@next/next": nextPlugin },
  rules: nextPlugin.configs.recommended.rules,
}];
