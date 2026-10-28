import { test } from "@playwright/test";
import { expect, openApp, readFakeState, unknownCommands } from "./fixtures/app";
import { makeProject, makeTicket } from "./fixtures/tauri-mock";
import type { Ticket } from "../src/types/ticket";

const project = makeProject();

test("moves a ticket to another column by dragging it", async ({ page }) => {
  await openApp(page, {
    projects: [project],
    activeProjectId: project.id,
    tickets: [makeTicket({ id: "TKT-1001", title: "Drag me" })],
  });

  const source = page.locator("button.card").filter({ hasText: "Drag me" });
  const done = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Done", exact: true }) });

  // HTML5 drag and drop needs the same DataTransfer handed to both events: a
  // mouse-only drag never populates the custom mime type the column checks.
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent("dragstart", { dataTransfer });
  const dropZone = done.locator(".drop-zone");
  await dropZone.dispatchEvent("dragover", { dataTransfer });
  await dropZone.dispatchEvent("drop", { dataTransfer });

  await expect(done).toContainText("Drag me");
  await expect(page.locator("section").filter({ hasText: "Backlog" })).not.toContainText(
    "Drag me",
  );

  const state = await readFakeState<{ tickets: Ticket[] }>(page);
  expect(state.tickets[0].status).toBe("done");

  expect(await unknownCommands(page)).toEqual([]);
});
