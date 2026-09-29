import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../lib/i18n";
import Projects from "../pages/projects";

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
        <MemoryRouter initialEntries={["/projects"]}>
          <Projects />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await userEvent.click(await screen.findByRole("button", { name: /Launch/i }));
    const select = await screen.findByRole("combobox", { name: /Prepare materials/i });
    expect(Array.from((select as HTMLSelectElement).options).map((option) => option.value)).toEqual(
      ["IN_PROGRESS", "DONE"],
    );
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
        <MemoryRouter initialEntries={["/projects"]}>
          <Projects />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not load your projects/i);
    expect(screen.queryByText(/No project invitations or active projects yet/i)).toBeNull();
  });

  it("opens a project from its query parameter and shows only assigned task progress", async () => {
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
                  description: "Prepare the launch.",
                  status: "ACTIVE",
                  activatedAt: "2026-09-01T00:00:00.000Z",
                  completedAt: null,
                  tasks: [
                    {
                      id: "task-1",
                      title: "Prepare materials",
                      description: null,
                      status: "DONE",
                      dueAt: "2026-09-10T00:00:00.000Z",
                    },
                    {
                      id: "task-2",
                      title: "Review copy",
                      description: null,
                      status: "TODO",
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
        <MemoryRouter initialEntries={["/projects?project=project-1"]}>
          <Projects />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Launch" })).toBeDefined();
    expect(screen.getByRole("progressbar", { name: /your task progress/i })).toHaveAttribute(
      "aria-valuenow",
      "1",
    );
    expect(screen.getByText(/Started/i)).toBeDefined();
    expect(screen.getByText("Prepare materials")).toBeDefined();
    expect(screen.getByText("Review copy")).toBeDefined();
  });

  it("shows invitations, active projects, and history as separate searchable views", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                id: "membership-1",
                status: "INVITED",
                project: {
                  id: "project-1",
                  name: "Launch",
                  description: null,
                  status: "ACTIVE",
                  tasks: [],
                },
              },
              {
                id: "membership-2",
                status: "ACCEPTED",
                project: {
                  id: "project-2",
                  name: "Website",
                  description: null,
                  status: "ACTIVE",
                  tasks: [],
                },
              },
              {
                id: "membership-3",
                status: "ACCEPTED",
                project: {
                  id: "project-3",
                  name: "Archive",
                  description: null,
                  status: "CLOSED",
                  tasks: [],
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
        <MemoryRouter initialEntries={["/projects"]}>
          <Projects />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("button", { name: /Invitations 1/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Active 1/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /History 1/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Launch/i })).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /Active 1/i }));
    expect(screen.getByRole("button", { name: /Website/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Launch/i })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /History 1/i }));
    expect(screen.getByRole("button", { name: /Archive/i })).toBeDefined();
  });
});
