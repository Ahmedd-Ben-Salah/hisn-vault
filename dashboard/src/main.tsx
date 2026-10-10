import "@fontsource/figtree/400.css";
import "@fontsource/figtree/500.css";
import "@fontsource/figtree/600.css";
import "@fontsource/figtree/700.css";
import "@fontsource/figtree/800.css";
import "@fontsource/figtree/900.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { Shell } from "./components/Shell";
import { SourceProvider, makeSource } from "./data/store";
import { Connect } from "./pages/Connect";
import { Demo } from "./pages/Demo";
import { Helper } from "./pages/Helper";
import { Home } from "./pages/Home";
import { Log } from "./pages/Log";
import { NotFound } from "./pages/NotFound";
import { PaymentDetail } from "./pages/PaymentDetail";
import { Payments } from "./pages/Payments";
import { People } from "./pages/People";
import { Rules } from "./pages/Rules";
import { Send } from "./pages/Send";

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/send", element: <Send /> },
      { path: "/payments", element: <Payments /> },
      { path: "/payments/:id", element: <PaymentDetail /> },
      { path: "/protection", element: <Rules /> },
      { path: "/rules", element: <Navigate to="/protection" replace /> },
      { path: "/people", element: <People /> },
      { path: "/helper", element: <Helper /> },
      { path: "/log", element: <Log /> },
      { path: "/demo", element: <Demo /> },
      { path: "/connect", element: <Connect /> },
      { path: "*", element: <NotFound /> },
    ],
  },
], { basename: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" });

const source = makeSource();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SourceProvider source={source}>
      <RouterProvider router={router} />
    </SourceProvider>
  </StrictMode>,
);
