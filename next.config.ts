import type { NextConfig } from "next";

// O servidor dev:test usa um diretório separado. Isso impede que um `next build`
// local substitua chunks que ainda estão sendo solicitados pelo servidor de
// desenvolvimento em execução.
const nextConfig: NextConfig = {
  distDir: process.env.MOVA_TEST_DEV_SERVER === "true" ? ".next-dev" : ".next",
  allowedDevOrigins: ["127.0.0.1"],
};
export default nextConfig;
