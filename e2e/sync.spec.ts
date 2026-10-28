import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { expect, openApp, queuePulls, unknownCommands } from "./fixtures/app";
import { makeProject, makeTicket } from "./fixtures/tauri-mock";

const project = makeProject();

function scene(pulls: Array<{ commits_pulled: number } | { error: string }>, conflicts: string[] = []) {
  return {
    projects: [project],
    activeProjectId: project.id,
    tickets: [makeTicket({ id: "TKT-1001", title: "First ticket" })],
    pulls,
    conflicts,
  };
}

function syncButton(page: Page) {
  return page.getByRole("button", { name: "Sync now" });
}

test("reports how many commits a successful pull brought", async ({ page }) => {
  await openApp(page, scene([{ commits_pulled: 2 }]));

  await syncButton(page).click();

  await expect(page.locator(".toast")).toContainText("Pulled 2 commits");
  await expect(page.getByText("Synced", { exact: true })).toBeVisible();
  await expect(page.getByText("Sync failed")).toHaveCount(0);

  expect(await unknownCommands(page)).toEqual([]);
});

test("keeps a failed sync on screen, in a toast, and copyable", async ({
  page,
}) => {
  const message = "git fetch failed: Could not resolve host: github.com";
  await openApp(page, scene([{ error: message }]));

  await syncButton(page).click();

  // The toast is transient, so it is asserted first.
  await expect(page.locator(".toast")).toContainText(message);
  const banner = page.getByRole("alert").filter({ hasText: "Sync failed" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(message);

  await banner.getByRole("button", { name: "Copy the sync error" }).click();
  const copied = await page.evaluate(
    () => (window as any).__GITTEAM_TEST__.clipboard as string[],
  );
  expect(copied).toContain(message);

  expect(await unknownCommands(page)).toEqual([]);
});

test("clears the banner when the retry succeeds", async ({ page }) => {
  await openApp(page, scene([{ error: "git pull failed: network is down" }]));

  await syncButton(page).click();
  const banner = page.getByRole("alert").filter({ hasText: "Sync failed" });
  await expect(banner).toBeVisible();

  await queuePulls(page, { commits_pulled: 0 });
  await banner.getByRole("button", { name: "Retry sync" }).click();

  await expect(banner).toHaveCount(0);
  await expect(page.getByText("Synced", { exact: true })).toBeVisible();
});

test("shows the conflict banner when the pull hits a conflict", async ({
  page,
}) => {
  await openApp(
    page,
    scene(
      [
        {
          error:
            "CONFLICT: error: could not apply 1a2b3c4... ticket: TKT-1001 sync",
        },
      ],
      ["TKT-1001.md"],
    ),
  );

  await syncButton(page).click();

  await expect(page.getByText("1 file in conflict")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open conflict resolution" }),
  ).toBeVisible();
  // A conflict is a different state from a plain failure: no error banner.
  await expect(page.getByText("Sync failed")).toHaveCount(0);

  expect(await unknownCommands(page)).toEqual([]);
});
