import { expect, type Page } from "@playwright/test";
import { installTauriMock, type FakeScene } from "./tauri-mock";

/**
 * Opens the app with a fake backend and waits until it finished booting.
 *
 * `bootDone` in `App.tsx` is what closes the loading spinner, and both the setup
 * screen and the board render after it. Waiting for the spinner to disappear is
 * the one landmark every scenario shares.
 */
export async function openApp(
  page: Page,
  scene: Partial<FakeScene>,
): Promise<void> {
  await installTauriMock(page, scene);
  await page.goto("/");
  await expect(page.locator(".animate-spin")).toHaveCount(0);
}

/** Fake-backend state, for the assertions that must not rely on the UI alone. */
export async function readFakeState<T = unknown>(page: Page): Promise<T> {
  return page.evaluate(
    () => JSON.parse(JSON.stringify((window as any).__GITTEAM_TEST__.state)),
  ) as Promise<T>;
}

/** Commands the fake does not implement. Non-empty means the harness drifted. */
export async function unknownCommands(page: Page): Promise<string[]> {
  return page.evaluate(
    () => [...(window as any).__GITTEAM_TEST__.unknownCommands],
  ) as Promise<string[]>;
}

/** Replaces the answers the following `git_pull` calls will get. */
export async function queuePulls(
  page: Page,
  ...answers: Array<{ commits_pulled: number } | { error: string }>
): Promise<void> {
  await page.evaluate((queued) => {
    (window as any).__GITTEAM_TEST__.enqueuePulls(...queued);
  }, answers);
}

export { expect };
