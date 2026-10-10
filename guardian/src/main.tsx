import "@fontsource/figtree/400.css";
import "@fontsource/figtree/500.css";
import "@fontsource/figtree/600.css";
import "@fontsource/figtree/700.css";
import "@fontsource/figtree/800.css";
import "@fontsource/figtree/900.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadOrCreateKey } from "./key";

const wallet = loadOrCreateKey();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App wallet={wallet} />
  </StrictMode>,
);
