import "./index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { useTranslation } from "react-i18next";

import App from "./App";
import { bootstrapLocale } from "./lib/i18n";
import { applyTheme, loadProgramConfig } from "./lib/theme";

const config = loadProgramConfig();
applyTheme(config.accentColor, config.theme);

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

const routerBasename = import.meta.env.BASE_URL.replace(/\/$/, "") || undefined;

function LocalizedApp(): JSX.Element {
  const { i18n: activeI18n } = useTranslation();
  return <App key={activeI18n.language} />;
}

void bootstrapLocale().then(() => {
  createRoot(rootEl).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename={routerBasename}>
          <LocalizedApp />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
});
