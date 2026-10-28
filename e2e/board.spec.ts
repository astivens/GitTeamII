import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { expect, openApp, readFakeState, unknownCommands } from "./fixtures/app";
import { makeProject, makeTicket } from "./fixtures/tauri-mock";
import type { Ticket } from "../src/types/ticket";

const project = makeProject();

function column(page: Page, label: string) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: label, exact: true }) });
}

function card(page: Page, title: string) {
  return page.locator("button.card").filter({ hasText: title });
}

test("renders the setup screen when no project is linked", async ({ page }) => {
  await openApp(page, {});

  await expect(
    page.getByRole("heading", { name: "GitTeam", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Connect your team's repository")).toBeVisible();
  expect(await unknownCommands(page)).toEqual([]);
});

test("renders the four columns with one card per ticket in its own column", async ({
  page,
}) => {
  await openApp(page, {
    projects: [project],
    activeProjectId: project.id,
    tickets: [
      makeTicket({ id: "TKT-1001", title: "Ship the board" }),
      makeTicket({
        id: "TKT-1002",
        title: "Review the sync",
        status: "review",
      }),
    ],
  });

  for (const label of ["Backlog", "In Progress", "Review", "Done"]) {
    await expect(
      page.getByRole("heading", { name: label, exact: true }),
    ).toBeVisible();
  }

  await expect(card(page, "Ship the board")).toBeVisible();
  await expect(card(page, "Review the sync")).toBeVisible();
  await expect(column(page, "Backlog")).toContainText("Ship the board");
  await expect(column(page, "Review")).toContainText("Review the sync");
  await expect(column(page, "Backlog")).not.toContainText("Review the sync");

  expect(await unknownCommands(page)).toEqual([]);
});

test("creates a ticket from the header and shows it on the board", async ({
  page,
}) => {
  await openApp(page, {
    projects: [project],
    activeProjectId: project.id,
  });

  await page
    .getByRole("banner")
    .getByRole("button", { name: "New ticket" })
    .click();
  await page.getByLabel("Title").fill("Fresh from the harness");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(card(page, "Fresh from the harness")).toBeVisible();
  await expect(column(page, "Backlog")).toContainText("Fresh from the harness");

  const state = await readFakeState<{ tickets: Ticket[] }>(page);
  expect(state.tickets.map((t) => t.title)).toEqual(["Fresh from the harness"]);
  expect(state.tickets[0].filename).toBe("TKT-1001.md");

  expect(await unknownCommands(page)).toEqual([]);
});

test("deletes a ticket from its edit modal", async ({ page }) => {
  await openApp(page, {
    projects: [project],
    activeProjectId: project.id,
    tickets: [makeTicket({ id: "TKT-1001", title: "Delete me" })],
  });

  page.on("dialog", (dialog) => void dialog.accept());
  await card(page, "Delete me").click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(card(page, "Delete me")).toHaveCount(0);
  const state = await readFakeState<{ tickets: Ticket[] }>(page);
  expect(state.tickets).toEqual([]);

  expect(await unknownCommands(page)).toEqual([]);
});
