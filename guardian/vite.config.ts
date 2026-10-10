import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function csp(relayer: string, mirror: string, rpc: string, extra: string): Plugin {
  const origins = [mirror || "https://testnet.mirrornode.hedera.com", rpc || "https://testnet.hashio.io"].map((u) => new URL(u).origin);
  origins.push(...extra.split(/\s+/).filter(Boolean));
  if (relayer) {
    const u = new URL(relayer);
    origins.push(u.origin, `${u.protocol === "https:" ? "wss" : "ws"}://${u.host}`);
  }
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    `connect-src 'self' ${origins.join(" ")}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return {
    name: "hisn-guardian-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    base: process.env.HISN_BASE ?? "/",
    plugins: [react(), tailwindcss(), csp(env.VITE_RELAYER_URL ?? "", env.VITE_MIRROR_URL ?? "", env.VITE_RPC_URL ?? "", env.VITE_CONNECT_ORIGINS ?? "")],
    server: { port: 5174, host: true },
    build: { assetsInlineLimit: 0 },
  };
});
