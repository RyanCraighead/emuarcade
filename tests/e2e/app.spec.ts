import { expect, test } from '@playwright/test';
import {
  encodeSharedState,
  withSharedStateCartridge,
} from '../../src/shared/sharedState';
import {
  calculateStateCartridgeSha256,
  encodeStateCartridgeBase64,
  splitStateCartridgePayload,
} from '../../src/shared/stateCartridge';

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

    const artwork = page.locator('.console-splash-art img');

    await expect
      .poll(async () => {
        return await artwork.evaluate((image) =>
          image instanceof HTMLImageElement && image.complete
            ? image.currentSrc
            : ''
        );
      })
      .toContain(artworkByProject[testInfo.project.name]);

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

test('local checkpoint sharing renders a playable custom-post preview', async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');

  const encoded = encodeSharedState(new Uint8Array(32_000), {
    core: 'nes',
    coreFingerprint: 'ejs-4.2.3:fceumm',
    gameTitle: 'Checkpoint Browser Test',
    romFingerprint: 'browser123456789',
  });
  const response = await request.post('/api/share-state', {
    data: {
      postData: encoded.postData,
      previewDataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==',
      previewKind: 'gif',
      title: 'Play from this test checkpoint',
    },
  });

  expect(response.ok()).toBe(true);
  const result = await response.json();
  expect(result.postDataBytes).toBeLessThanOrEqual(1_800);

  await page.goto(result.postUrl);
  await expect(
    page.getByRole('button', {
      name: 'Play Checkpoint Browser Test from this checkpoint',
    })
  ).toBeVisible();
  await expect(
    page.getByRole('img', {
      name: 'Checkpoint Browser Test checkpoint preview',
    })
  ).toBeVisible();

  await page.getByRole('button', { name: /Play Checkpoint Browser Test/ }).click();
  await expect(page).toHaveURL(/game\.html\?localShare=/);
  await expect(page.getByText('Play shared checkpoint')).toBeVisible();
});

test('local State Cartridge checkpoint round trips through a custom post', async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');

  const state = new Uint8Array(24_000);
  let random = 0x6d2b79f5;

  for (let index = 0; index < state.length; index += 1) {
    random ^= random << 13;
    random ^= random >>> 17;
    random ^= random << 5;
    state[index] = random & 0xff;
  }

  const encoded = encodeSharedState(state, {
    core: 'nes',
    coreFingerprint: 'ejs-4.2.3:fceumm',
    gameTitle: 'Cartridge Browser Test',
    romFingerprint: 'cartridge1234567',
  });
  expect(encoded.fits).toBe(false);

  const payloads = splitStateCartridgePayload(encoded.compressedPayload);
  const chunks = [];

  for (let index = 0; index < payloads.length; index += 1) {
    const payload = payloads[index];

    if (!payload) {
      throw new Error('Missing test cartridge chunk');
    }

    const response = await request.post('/api/state-cartridge/chunk', {
      data: {
        data: encodeStateCartridgeBase64(payload),
        index,
        count: payloads.length,
      },
    });

    expect(response.ok()).toBe(true);
    chunks.push(await response.json());
  }

  const manifestResponse = await request.post('/api/state-cartridge/manifest', {
    data: {
      v: 1,
      n: encoded.compressedBytes,
      h: await calculateStateCartridgeSha256(encoded.compressedPayload),
      chunks,
    },
  });
  expect(manifestResponse.ok()).toBe(true);
  const manifestResult = await manifestResponse.json();
  const postData = withSharedStateCartridge(
    encoded.postData,
    manifestResult.mediaUrl,
    encoded.compressedBytes
  );
  const shareResponse = await request.post('/api/share-state', {
    data: {
      postData,
      previewDataUrl: null,
      previewKind: 'hidden',
      title: 'Cartridge checkpoint test',
    },
  });

  expect(shareResponse.ok()).toBe(true);
  const result = await shareResponse.json();
  expect(result.postDataBytes).toBeLessThanOrEqual(1_800);

  await page.goto(result.postUrl);
  await page
    .getByRole('button', { name: /Play Cartridge Browser Test/ })
    .click();
  await expect(page).toHaveURL(/game\.html\?localShare=/);
  await expect(page.getByText('Play shared checkpoint')).toBeVisible();
});
