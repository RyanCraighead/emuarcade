import { expect, test } from '@playwright/test';

const artworkByProject: Record<string, string> = {
  desktop: 'splash-console-wide.webp',
  phone: 'splash-console-phone.webp',
  square: 'splash-console-square.webp',
};

const expectNoHorizontalOverflow = async (
  page: import('@playwright/test').Page
) => {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));

  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
};

test.describe('responsive app flow', () => {
  test('renders the correct launcher and opens the expanded app', async ({
    page,
  }, testInfo) => {
    await page.goto('/splash.html');

    const launchButton = page.getByRole('button', { name: 'Open EmuArcade' });
    await expect(launchButton).toBeVisible();
    await expect(page.locator('.console-splash-device')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const currentArtwork = await page
      .locator('.console-splash-art img')
      .evaluate((image) =>
        image instanceof HTMLImageElement ? image.currentSrc : ''
      );
    expect(currentArtwork).toContain(artworkByProject[testInfo.project.name]);

    await launchButton.click();
    await expect(page).toHaveURL(/\/game\.html$/);
    await expect(
      page.getByRole('img', { name: 'EmuArcade cabinet' })
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ready' })).toBeVisible();

    if (testInfo.project.name === 'desktop') {
      await expect(page.getByRole('heading', { name: 'Import' })).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Library' })
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Settings' })
      ).toBeVisible();
    } else {
      for (const panelName of ['Play', 'Library', 'Import', 'Settings']) {
        await expect(
          page.getByRole('button', { exact: true, name: panelName })
        ).toBeVisible();
      }
    }
    await expectNoHorizontalOverflow(page);
  });

  test('keeps every primary page reachable in one viewport', async ({
    page,
  }, testInfo) => {
    await page.goto('/game.html');

    if (testInfo.project.name === 'desktop') {
      for (const headingName of ['Import', 'Library', 'Settings']) {
        await expect(
          page.getByRole('heading', { exact: true, name: headingName })
        ).toBeVisible();
      }
      await expectNoHorizontalOverflow(page);
      return;
    }

    for (const panelName of ['Library', 'Import', 'Settings', 'Play']) {
      const panelButton = page.getByRole('button', {
        exact: true,
        name: panelName,
      });
      await panelButton.click();
      await expect(panelButton).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  });
});

test('local GIF sharing stores and serves an exact media payload', async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');

  const dataUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==';
  const response = await request.post('/api/share-clip', {
    data: {
      core: 'nes',
      dataUrl,
      durationMs: 3_000,
      gameTitle: 'Browser Test',
      mimeType: 'image/gif',
      shareFormat: 'gif',
      sizeBytes: 16,
      thumbnailDataUrl: null,
    },
  });

  expect(response.ok()).toBe(true);
  const result = await response.json();
  expect(result.shareKind).toBe('gif');
  expect(result.postUrl).toMatch(/^\/local-clips\//);

  const postPage = await request.get(result.postUrl);
  expect(postPage.ok()).toBe(true);
  expect(await postPage.text()).toContain('Browser Test');

  const mediaResponse = await request.get(result.mediaUrl);
  expect(mediaResponse.ok()).toBe(true);
  expect(mediaResponse.headers()['content-type']).toContain('image/gif');
  expect((await mediaResponse.body()).byteLength).toBeGreaterThan(0);
});
