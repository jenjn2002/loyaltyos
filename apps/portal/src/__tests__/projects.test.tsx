import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Projects from "../pages/projects";
import i18n from "../lib/i18n";

describe("Projects", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en-US");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not offer returning a task to TODO when the member API rejects that transition", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                id: "membership-1",
                status: "ACCEPTED",
                project: {
                  id: "project-1",
                  name: "Launch",
                  description: null,
                  status: "ACTIVE",
                  fieldValues: {},
                  tasks: [
                    {
                      id: "task-1",
                      title: "Prepare materials",
                      description: null,
                      status: "IN_PROGRESS",
                      dueAt: null,
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Projects />
      </QueryClientProvider>,
    );

    const select = await screen.findByRole("combobox", { name: /Prepare materials/i });
    expect(Array.from((select as HTMLSelectElement).options).map((option) => option.value)).toEqual([
      "IN_PROGRESS",
      "DONE",
    ]);
  });

  it("shows the load error without also claiming there are no projects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "Temporary failure" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Projects />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not load your projects/i);
    expect(screen.queryByText(/No project invitations or active projects yet/i)).toBeNull();
  });
});
