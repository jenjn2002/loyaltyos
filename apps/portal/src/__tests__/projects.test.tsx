import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../lib/i18n";
import Projects from "../pages/projects";

function renderProjects(initialEntry = "/projects") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Projects />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function projectResponse(data: unknown[]) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Projects", () => {
  beforeEach(async () => {
    sessionStorage.clear();
    await i18n.changeLanguage("en-US");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("shows the accepted member roster without exposing identifiers or project finance", async () => {
    sessionStorage.setItem("member-id", "member-1");
    sessionStorage.setItem("program-id", "program-1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(projectResponse([
      {
        id: "membership-1",
        status: "ACCEPTED",
        project: {
          id: "project-1",
          name: "Launch",
          description: "Prepare the launch.",
          status: "ACTIVE",
          members: [
            {
              memberId: "member-1",
              name: "Taylor Member",
              department: "Sales",
              photoUrl: null,
              email: "private1@example.com",
            },
            {
              memberId: "member-2",
              name: "Morgan Colleague",
              department: null,
              photoUrl: "/morgan.png",
              email: "private2@example.com",
            },
          ],
          budget: 50000,
          distributionDescription: "private internal rationale",
          tasks: [{ id: "task-private", title: "Private task", status: "TODO" }],
        },
      },
    ])));

    const rendered = renderProjects("/projects?project=project-1");

    expect(await screen.findByRole("heading", { name: "Launch" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Project team" })).toBeDefined();
    expect(screen.getByText("Taylor Member")).toBeDefined();
    expect(screen.getByText("Sales")).toBeDefined();
    expect(screen.getByText("Morgan Colleague")).toBeDefined();
    expect(screen.getByText("You")).toBeDefined();
    expect(rendered.container.querySelector('img[src="/morgan.png"]')).not.toBeNull();
    expect(screen.queryByText("member-1")).toBeNull();
    expect(screen.queryByText("member-2")).toBeNull();
    expect(screen.queryByText(/private internal rationale|private[12]@example\.com|50,000|Private task/i)).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
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

    renderProjects();

    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not load your projects/i);
    expect(screen.queryByText(/No projects yet/i)).toBeNull();
  });

  it("opens a project from its query parameter and shows status dates without tasks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(projectResponse([
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
            members: [],
          },
        },
      ])),
    );

    renderProjects("/projects?project=project-1");

    expect(await screen.findByRole("heading", { name: "Launch" })).toBeDefined();
    expect(screen.getByText(/Started/i)).toBeDefined();
    expect(screen.getByText("No active team members are listed yet.")).toBeDefined();
    expect(screen.queryByText(/task/i)).toBeNull();
  });

  it("keeps invitation and history actions consistent with project lifecycle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(projectResponse([
        {
          id: "membership-1",
          status: "INVITED",
          project: { id: "project-1", name: "Open invite", description: null, status: "ACTIVE" },
        },
        {
          id: "membership-2",
          status: "INVITED",
          project: { id: "project-2", name: "Closed invite", description: null, status: "CLOSED" },
        },
        {
          id: "membership-3",
          status: "ACCEPTED",
          project: { id: "project-3", name: "Archive", description: null, status: "CLOSED", members: [] },
        },
      ])),
    );

    renderProjects();

    expect(await screen.findByRole("button", { name: /Invitations 1/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /History 2/i })).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /Open invite/i }));
    expect(screen.getByRole("button", { name: "Accept invitation" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Decline" })).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /Back to projects/i }));
    await userEvent.click(screen.getByRole("button", { name: /History 2/i }));
    await userEvent.click(screen.getByRole("button", { name: /Closed invite/i }));
    expect(screen.queryByRole("button", { name: "Accept invitation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    expect(screen.getByText(/invitation can no longer be accepted/i)).toBeDefined();
  });

  it("shows invitations, active projects, and history as separate searchable views", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(projectResponse([
      {
        id: "membership-1",
        status: "INVITED",
        project: { id: "project-1", name: "Launch", description: null, status: "ACTIVE" },
      },
      {
        id: "membership-2",
        status: "ACCEPTED",
        project: { id: "project-2", name: "Website", description: null, status: "ACTIVE", members: [] },
      },
      {
        id: "membership-3",
        status: "ACCEPTED",
        project: { id: "project-3", name: "Archive", description: null, status: "CLOSED", members: [] },
      },
    ])));

    renderProjects();

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
