(function () {
  const databaseName = 'emuarcade-library';
  const databaseVersion = 2;
  const storeName = 'games';
  const saveArtifactStoreName = 'saveArtifacts';
  const touchLayoutStoreName = 'touchLayouts';
  const emulatorDataPath = '/emulatorjs/data/';
  const statusElement = document.getElementById('runner-status');
  const objectUrls = [];
  const activeRunnerStorageKey = 'emuarcade-active-runner';
  const runnerChannelName = 'emuarcade-runner';
  const runnerInstanceId =
    Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const defaultSettings = {
    volume: 0.8,
    muted: false,
    shader: 'disabled',
    n64Core: 'parallel_n64',
    rewind: true,
    threads: false,
    virtualGamepad: true,
    startOnLoad: true,
  };
  let sessionSettings = defaultSettings;
  let pausedForLifecycle = false;
  let pausedForOwnership = false;
  let pausedForSharedState = false;
  let sharedStateLoadFailures = 0;
  let sharedStateLoadInProgress = false;
  let sharedStateLoadRetryTimer = null;
  let stopped = false;
  let runnerChannel = null;
  const clipIcon =
    '<svg viewBox="0 0 512 512"><path d="M64 96c-17.7 0-32 14.3-32 32v256c0 17.7 14.3 32 32 32h288c17.7 0 32-14.3 32-32v-20.4l73.4 48.9c9.8 6.5 22.6 7.2 33 1.6S507 397.5 507 385.8V126.2c0-11.7-6.5-22.4-16.6-28s-23.2-4.9-33 1.6L384 148.7V128c0-17.7-14.3-32-32-32H64zm56 80h176c13.3 0 24 10.7 24 24v112c0 13.3-10.7 24-24 24H120c-13.3 0-24-10.7-24-24V200c0-13.3 10.7-24 24-24z"/></svg>';
  const rotateIcon =
    '<svg viewBox="0 0 512 512"><path d="M48 128c0-17.7 14.3-32 32-32h227.1l-54.6-54.6C240 28.9 240 8.6 252.5-3.9s32.8-12.5 45.3 0l109.3 109.3c12.5 12.5 12.5 32.8 0 45.3L297.8 260c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L307.1 160H112v224h288v-96c0-17.7 14.3-32 32-32s32 14.3 32 32v128c0 17.7-14.3 32-32 32H80c-17.7 0-32-14.3-32-32V128z"/></svg>';
  const touchControlsIcon =
    '<svg viewBox="0 0 640 512"><path d="M96 224c-35.3 0-64 28.7-64 64v48c0 79.5 64.5 144 144 144h288c79.5 0 144-64.5 144-144v-48c0-35.3-28.7-64-64-64h-34.7c-17 0-33.3-6.7-45.3-18.7L421.3 162.7c-12-12-28.3-18.7-45.3-18.7H264c-17 0-33.3 6.7-45.3 18.7L176 205.3c-12 12-28.3 18.7-45.3 18.7H96zm64 80h40v-40c0-8.8 7.2-16 16-16h32c8.8 0 16 7.2 16 16v40h40c8.8 0 16 7.2 16 16v32c0 8.8-7.2 16-16 16h-40v40c0 8.8-7.2 16-16 16h-32c-8.8 0-16-7.2-16-16v-40h-40c-8.8 0-16-7.2-16-16v-32c0-8.8 7.2-16 16-16zm304 88a40 40 0 1 1 0-80 40 40 0 1 1 0 80zm80-80a40 40 0 1 1 0-80 40 40 0 1 1 0 80zM120 32c13.3 0 24 10.7 24 24v72h72c13.3 0 24 10.7 24 24s-10.7 24-24 24h-72v72c0 13.3-10.7 24-24 24s-24-10.7-24-24v-72H24c-13.3 0-24-10.7-24-24s10.7-24 24-24h72V56c0-13.3 10.7-24 24-24z"/></svg>';
  const shareStateIcon =
    '<svg viewBox="0 0 512 512"><path d="M48 64c0-17.7 14.3-32 32-32h288c8.5 0 16.6 3.4 22.6 9.4l80 80c6 6 9.4 14.1 9.4 22.6v304c0 17.7-14.3 32-32 32H80c-17.7 0-32-14.3-32-32V64zm96 0v128h224V64H144zm240 368V288H128v144h256zM176 96h144v64H176V96z"/></svg>';
  let activeTouchLayout = null;
  let touchEditor = null;
  let pendingSharedState = null;
  let currentGame = null;

  const setStatus = (message, isError) => {
    if (!statusElement) {
      return;
    }

    statusElement.textContent = message;
    statusElement.classList.toggle('is-error', Boolean(isError));
  };

  const hideStatus = () => {
    if (statusElement) {
      statusElement.classList.add('is-hidden');
    }
  };

  const getCaptureStream = (fps) => {
    const canvas = document.querySelector('canvas');

    if (!canvas) {
      return null;
    }

    if (
      window.EJS_emulator &&
      typeof window.EJS_emulator.collectScreenRecordingMediaTracks ===
        'function'
    ) {
      const stream = window.EJS_emulator.collectScreenRecordingMediaTracks(
        canvas,
        fps
      );

      if (stream) {
        return stream;
      }
    }

    return canvas.captureStream(fps);
  };

  window.emuarcadeCaptureStream = getCaptureStream;

  const waitForPresentedVideoFrame = (video) => {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ready) => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        video.removeEventListener('loadeddata', handleLoadedData);
        resolve(ready);
      };
      const handleLoadedData = () => {
        window.requestAnimationFrame(() => finish(true));
      };
      const timeoutId = window.setTimeout(() => finish(false), 1500);

      if (typeof video.requestVideoFrameCallback === 'function') {
        video.requestVideoFrameCallback(() => finish(true));
      } else if (video.readyState >= 2) {
        window.requestAnimationFrame(() => finish(true));
      } else {
        video.addEventListener('loadeddata', handleLoadedData, { once: true });
      }
    });
  };

  const capturePresentedFrame = async () => {
    const canvas = document.querySelector('canvas');
    const stream = getCaptureStream(30);

    if (!canvas || !stream || stream.getVideoTracks().length === 0) {
      stream?.getTracks().forEach((track) => track.stop());
      return null;
    }

    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    try {
      await video.play();

      if (!(await waitForPresentedVideoFrame(video))) {
        return null;
      }

      const sourceWidth = video.videoWidth || canvas.width;
      const sourceHeight = video.videoHeight || canvas.height;
      const scale = Math.min(1, 640 / Math.max(1, sourceWidth));
      const output = document.createElement('canvas');
      output.width = Math.max(1, Math.round(sourceWidth * scale));
      output.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = output.getContext('2d', { alpha: false });

      if (!context) {
        return null;
      }

      context.imageSmoothingEnabled = false;
      context.drawImage(video, 0, 0, output.width, output.height);
      return output.toDataURL('image/png');
    } catch (error) {
      console.warn('Unable to capture presented emulator frame', error);
      return null;
    } finally {
      video.pause();
      video.srcObject = null;
      stream.getTracks().forEach((track) => track.stop());
    }
  };

  window.emuarcadeCaptureFrame = capturePresentedFrame;

  const getEmulator = () => {
    return window.EJS_emulator || null;
  };

  const isTouchControlDevice = () => {
    return (
      (globalThis.navigator?.maxTouchPoints ?? 0) > 0 ||
      window.matchMedia('(pointer: coarse)').matches ||
      'ontouchstart' in window ||
      window.matchMedia('(max-width: 820px)').matches ||
      window.matchMedia('(max-aspect-ratio: 3/4)').matches ||
      document.querySelector('.ejs_virtualGamepad_button, .b_dpad') !== null
    );
  };

  const getTouchLayoutCacheKey = (core) => {
    return 'emuarcade-touch-layout:' + core + ':v1';
  };

  const createTouchLayout = (core) => {
    return {
      controls: {},
      core,
      setupComplete: false,
      updatedAt: new Date(0).toISOString(),
      version: 1,
    };
  };

  const readLegacyTouchLayout = (core) => {
    try {
      const payload = window.localStorage.getItem(getTouchLayoutCacheKey(core));

      if (!payload) {
        return null;
      }

      const layout = JSON.parse(payload);

      if (layout && layout.version === 1 && layout.core === core) {
        window.localStorage.removeItem(getTouchLayoutCacheKey(core));
        return layout;
      }
    } catch (error) {
      console.warn('Unable to read legacy touch layout cache', error);
    }

    return null;
  };

  const readLocalTouchLayout = async (core) => {
    try {
      const layout = await readLocalRecord(touchLayoutStoreName, core);

      if (layout && layout.version === 1 && layout.core === core) {
        return layout;
      }
    } catch (error) {
      console.warn('Unable to read local touch layout', error);
    }

    return readLegacyTouchLayout(core);
  };

  const writeLocalTouchLayout = async (layout) => {
    try {
      await writeLocalRecord(touchLayoutStoreName, layout);
    } catch (error) {
      console.warn('Unable to save local touch layout', error);
    }
  };

  const saveTouchLayout = async (layout) => {
    layout.updatedAt = new Date().toISOString();
    await writeLocalTouchLayout(layout);
  };

  const loadTouchLayout = async (core) => {
    activeTouchLayout = (await readLocalTouchLayout(core)) || createTouchLayout(core);
    await writeLocalTouchLayout(activeTouchLayout);

    return activeTouchLayout;
  };

  const waitForTouchControls = async () => {
    for (let index = 0; index < 80; index += 1) {
      const parent = document.querySelector('.ejs_virtualGamepad_parent');

      if (parent && parent.querySelector('.ejs_virtualGamepad_button, .b_dpad')) {
        return parent;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }

    return document.querySelector('.ejs_virtualGamepad_parent');
  };

  const getTouchControlId = (element) => {
    const buttonClass = [...element.classList].find((className) =>
      className.startsWith('b_')
    );

    if (buttonClass) {
      return buttonClass.slice(2);
    }

    return element.textContent?.trim().toLowerCase().replace(/\s+/g, '-') || '';
  };

  const ensureOriginalTouchStyle = (element) => {
    if (!element.dataset.emuarcadeOriginalStyle) {
      element.dataset.emuarcadeOriginalStyle = element.getAttribute('style') || '';
    }
  };

  const restoreTouchControlStyle = (element) => {
    if (element.dataset.emuarcadeOriginalStyle !== undefined) {
      element.setAttribute('style', element.dataset.emuarcadeOriginalStyle);
    }

    element.classList.remove(
      'emuarcade-touch-control-target',
      'emuarcade-touch-control-hidden'
    );
  };

  const getEditableTouchControls = () => {
    const parent = document.querySelector('.ejs_virtualGamepad_parent');

    if (!parent) {
      return [];
    }

    const controls = [
      ...parent.querySelectorAll(
        '.ejs_virtualGamepad_button, .ejs_virtualGamepad_top > [class*="b_"], .ejs_virtualGamepad_bottom > [class*="b_"], .ejs_virtualGamepad_left > [class*="b_"], .ejs_virtualGamepad_right > [class*="b_"]'
      ),
    ];
    const seen = new Set();

    return controls.filter((control) => {
      const id = getTouchControlId(control);

      if (!id || seen.has(id)) {
        return false;
      }

      seen.add(id);
      control.dataset.emuarcadeControlId = id;
      ensureOriginalTouchStyle(control);

      return true;
    });
  };

  const clamp = (value, min, max) => {
    return Math.min(Math.max(value, min), max);
  };

  const setTouchControlPosition = (element, x, y) => {
    element.style.position = 'fixed';
    element.style.left = clamp(x, 4, 96).toFixed(2) + '%';
    element.style.top = clamp(y, 5, 95).toFixed(2) + '%';
    element.style.right = 'auto';
    element.style.bottom = 'auto';
    element.style.margin = '0';
    element.style.transform = 'translate(-50%, -50%)';
    element.style.zIndex = '12';
  };

  const getElementCenterPercent = (element) => {
    const rect = element.getBoundingClientRect();

    return {
      x: clamp(((rect.left + rect.width / 2) / window.innerWidth) * 100, 4, 96),
      y: clamp(((rect.top + rect.height / 2) / window.innerHeight) * 100, 5, 95),
    };
  };

  const applyTouchLayout = (layout, editing) => {
    getEditableTouchControls().forEach((control) => {
      const id = control.dataset.emuarcadeControlId;
      const item = id ? layout.controls[id] : null;

      if (!id) {
        return;
      }

      control.classList.add('emuarcade-touch-control-target');

      if (item?.x !== undefined && item?.y !== undefined) {
        setTouchControlPosition(control, item.x, item.y);
      } else if (!item?.hidden) {
        restoreTouchControlStyle(control);
        control.classList.add('emuarcade-touch-control-target');
      }

      control.classList.toggle(
        'emuarcade-touch-control-hidden',
        item?.hidden === true
      );

      if (item?.hidden === true && !editing) {
        control.style.display = 'none';
      } else if (item?.hidden === true && editing) {
        control.style.display = '';
      }
    });
  };

  const closeTouchSetupPrompt = () => {
    document.querySelector('.emuarcade-touch-setup')?.remove();
  };

  const closeTouchEditor = (saveChanges) => {
    if (!touchEditor) {
      return;
    }

    touchEditor.cleanup.forEach((cleanup) => cleanup());
    document.body.classList.remove('emuarcade-touch-editing');
    document.body.classList.remove('emuarcade-touch-remove-mode');
    touchEditor.root.remove();

    if (saveChanges && activeTouchLayout) {
      activeTouchLayout.setupComplete = true;
      void saveTouchLayout(activeTouchLayout).catch((error) => {
        console.warn('Unable to save touch controls', error);
      });
      applyTouchLayout(activeTouchLayout, false);
      displayEmulatorMessage('Touch controls saved');
    } else if (activeTouchLayout) {
      applyTouchLayout(activeTouchLayout, false);
    }

    touchEditor = null;
  };

  const resetTouchLayout = () => {
    if (!activeTouchLayout) {
      return;
    }

    activeTouchLayout.controls = {};
    getEditableTouchControls().forEach(restoreTouchControlStyle);
    applyTouchLayout(activeTouchLayout, true);
  };

  const toggleTouchControlHidden = (control) => {
    if (!activeTouchLayout) {
      return;
    }

    const id = control.dataset.emuarcadeControlId;

    if (!id) {
      return;
    }

    const current = activeTouchLayout.controls[id] || getElementCenterPercent(control);
    activeTouchLayout.controls[id] = {
      ...current,
      hidden: !(activeTouchLayout.controls[id]?.hidden === true),
    };

    applyTouchLayout(activeTouchLayout, true);
  };

  const openTouchEditor = async (game) => {
    if (!isTouchControlDevice()) {
      displayEmulatorMessage('Touch controls are for mobile devices');
      return;
    }

    const parent = await waitForTouchControls();

    if (!parent) {
      displayEmulatorMessage('Touch controls are not ready');
      return;
    }

    closeTouchSetupPrompt();
    closeTouchEditor(false);

    const layout = activeTouchLayout || (await loadTouchLayout(game.core));
    const root = document.createElement('div');
    const title = document.createElement('strong');
    const removeButton = document.createElement('button');
    const resetButton = document.createElement('button');
    const doneButton = document.createElement('button');
    const hint = document.createElement('span');

    root.className = 'emuarcade-touch-editor';
    title.textContent = 'Touch Controls';
    removeButton.type = 'button';
    removeButton.textContent = 'Hide control';
    removeButton.setAttribute('aria-pressed', 'false');
    resetButton.type = 'button';
    resetButton.textContent = 'Reset';
    doneButton.type = 'button';
    doneButton.textContent = 'Done';
    hint.setAttribute('aria-live', 'polite');
    hint.textContent = 'Drag controls to move them.';

    root.append(title, hint, removeButton, resetButton, doneButton);
    document.body.appendChild(root);
    document.body.classList.add('emuarcade-touch-editing');

    touchEditor = {
      cleanup: [],
      drag: null,
      removeMode: false,
      root,
    };

    applyTouchLayout(layout, true);

    const setRemoveMode = (enabled) => {
      if (!touchEditor) {
        return;
      }

      touchEditor.removeMode = enabled;
      removeButton.classList.toggle('is-active', enabled);
      removeButton.setAttribute('aria-pressed', String(enabled));
      removeButton.textContent = enabled ? 'Cancel hide' : 'Hide control';
      hint.textContent = enabled
        ? 'Tap a control to hide or restore it.'
        : 'Drag controls to move them.';
      document.body.classList.toggle('emuarcade-touch-remove-mode', enabled);
    };

    const onDone = () => closeTouchEditor(true);
    const onReset = () => {
      setRemoveMode(false);
      resetTouchLayout();
    };
    const toggleRemoveMode = () => {
      setRemoveMode(!touchEditor?.removeMode);
    };

    removeButton.addEventListener('click', toggleRemoveMode);
    resetButton.addEventListener('click', onReset);
    doneButton.addEventListener('click', onDone);
    touchEditor.cleanup.push(() =>
      removeButton.removeEventListener('click', toggleRemoveMode)
    );
    touchEditor.cleanup.push(() =>
      resetButton.removeEventListener('click', onReset)
    );
    touchEditor.cleanup.push(() =>
      doneButton.removeEventListener('click', onDone)
    );

    const swallowTouch = (event) => {
      if (document.body.classList.contains('emuarcade-touch-editing')) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    };

    const onPointerDown = (event) => {
      const control = event.currentTarget;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (!touchEditor || !activeTouchLayout) {
        return;
      }

      if (touchEditor.removeMode) {
        toggleTouchControlHidden(control);
        setRemoveMode(false);
        return;
      }

      const id = control.dataset.emuarcadeControlId;

      if (!id) {
        return;
      }

      const current =
        activeTouchLayout.controls[id] || getElementCenterPercent(control);

      activeTouchLayout.controls[id] = {
        ...current,
        hidden: activeTouchLayout.controls[id]?.hidden === true,
      };

      control.setPointerCapture?.(event.pointerId);
      touchEditor.drag = {
        control,
        id,
      };
    };

    const onPointerMove = (event) => {
      if (!touchEditor?.drag || !activeTouchLayout) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const position = {
        x: clamp((event.clientX / window.innerWidth) * 100, 4, 96),
        y: clamp((event.clientY / window.innerHeight) * 100, 5, 95),
      };

      activeTouchLayout.controls[touchEditor.drag.id] = {
        ...activeTouchLayout.controls[touchEditor.drag.id],
        ...position,
      };
      setTouchControlPosition(touchEditor.drag.control, position.x, position.y);
    };

    const onPointerUp = (event) => {
      if (!touchEditor?.drag) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      touchEditor.drag.control.releasePointerCapture?.(event.pointerId);
      touchEditor.drag = null;
    };

    getEditableTouchControls().forEach((control) => {
      control.addEventListener('pointerdown', onPointerDown, true);
      control.addEventListener('pointermove', onPointerMove, true);
      control.addEventListener('pointerup', onPointerUp, true);
      control.addEventListener('pointercancel', onPointerUp, true);
      control.addEventListener('touchstart', swallowTouch, true);
      control.addEventListener('touchmove', swallowTouch, true);
      control.addEventListener('touchend', swallowTouch, true);
      control.addEventListener('touchcancel', swallowTouch, true);
      touchEditor.cleanup.push(() => {
        control.removeEventListener('pointerdown', onPointerDown, true);
        control.removeEventListener('pointermove', onPointerMove, true);
        control.removeEventListener('pointerup', onPointerUp, true);
        control.removeEventListener('pointercancel', onPointerUp, true);
        control.removeEventListener('touchstart', swallowTouch, true);
        control.removeEventListener('touchmove', swallowTouch, true);
        control.removeEventListener('touchend', swallowTouch, true);
        control.removeEventListener('touchcancel', swallowTouch, true);
      });
    });
  };

  const showTouchSetupPrompt = (game) => {
    if (document.querySelector('.emuarcade-touch-setup') || touchEditor) {
      return;
    }

    const root = document.createElement('div');
    const panel = document.createElement('div');
    const title = document.createElement('strong');
    const text = document.createElement('p');
    const setup = document.createElement('button');
    const defaults = document.createElement('button');

    root.className = 'emuarcade-touch-setup';
    panel.className = 'emuarcade-touch-setup-panel';
    title.textContent = 'Set Up Touch Controls';
    text.textContent = 'Move or hide controls for this console.';
    setup.type = 'button';
    setup.textContent = 'Customize';
    defaults.type = 'button';
    defaults.textContent = 'Use Defaults';

    panel.append(title, text, setup, defaults);
    root.appendChild(panel);
    document.body.appendChild(root);

    setup.addEventListener('click', () => {
      root.remove();
      void openTouchEditor(game);
    });
    defaults.addEventListener('click', () => {
      if (!activeTouchLayout) {
        activeTouchLayout = createTouchLayout(game.core);
      }

      activeTouchLayout.setupComplete = true;
      void saveTouchLayout(activeTouchLayout).catch((error) => {
        console.warn('Unable to save default touch setup', error);
      });
      root.remove();
    });
  };

  const loadAndApplyTouchLayout = async (game) => {
    if (!isTouchControlDevice()) {
      return;
    }

    const layout = await loadTouchLayout(game.core);
    const parent = await waitForTouchControls();

    if (parent) {
      applyTouchLayout(layout, false);
    }
  };

  const maybeStartTouchSetup = async (game) => {
    if (!isTouchControlDevice()) {
      return;
    }

    const layout = activeTouchLayout || (await loadTouchLayout(game.core));

    if (layout.setupComplete) {
      return;
    }

    const parent = await waitForTouchControls();

    if (parent) {
      showTouchSetupPrompt(game);
    }
  };

  const getStateSlot = () => {
    const emulator = getEmulator();
    const slot = emulator?.getSettingValue?.('save-state-slot');

    return slot ? String(slot) : '1';
  };

  const toUint8Array = (value) => {
    if (value instanceof Uint8Array) {
      return value;
    }

    if (value instanceof ArrayBuffer) {
      return new Uint8Array(value);
    }

    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }

    return null;
  };

  const getBaseFileName = () => {
    const emulator = getEmulator();

    if (emulator && typeof emulator.getBaseFileName === 'function') {
      return emulator.getBaseFileName();
    }

    return 'game';
  };

  const getBatterySaveFileName = () => {
    const emulator = getEmulator();
    const path = emulator?.gameManager?.getSaveFilePath?.();

    if (typeof path === 'string' && path.trim()) {
      return path.split('/').pop() || 'game.sav';
    }

    return getBaseFileName() + '.sav';
  };

  const displayEmulatorMessage = (message) => {
    const emulator = getEmulator();

    if (emulator && typeof emulator.displayMessage === 'function') {
      emulator.displayMessage(message);
    }
  };

  const getSaveArtifactId = (gameId, kind, slot) => {
    return [gameId, kind, slot].join(':');
  };

  const getSaveArtifact = async (gameId, kind, slot) => {
    return await readLocalRecord(
      saveArtifactStoreName,
      getSaveArtifactId(gameId, kind, slot)
    );
  };

  const persistSaveArtifact = async (artifact) => {
    await writeLocalRecord(saveArtifactStoreName, artifact);
  };

  const writeBatterySaveToCore = (bytes) => {
    const emulator = getEmulator();
    const manager = emulator?.gameManager;
    const path = manager?.getSaveFilePath?.();

    if (!manager || !path) {
      return false;
    }

    const paths = path.split('/');
    let currentPath = '';

    for (let index = 0; index < paths.length - 1; index += 1) {
      if (!paths[index]) {
        continue;
      }

      currentPath += '/' + paths[index];

      if (!manager.FS.analyzePath(currentPath).exists) {
        manager.FS.mkdir(currentPath);
      }
    }

    if (manager.FS.analyzePath(path).exists) {
      manager.FS.unlink(path);
    }

    manager.FS.writeFile(path, bytes);
    manager.loadSaveFiles();

    return true;
  };

  const persistLocalState = async (bytes) => {
    const emulator = getEmulator();

    if (
      emulator?.storage?.states &&
      typeof emulator.storage.states.put === 'function' &&
      typeof emulator.getBaseFileName === 'function' &&
      (!emulator.saveInBrowserSupported ||
        emulator.saveInBrowserSupported() === true)
    ) {
      await emulator.storage.states.put(getBaseFileName() + '.state', bytes);
    }
  };

  const loadLocalState = async () => {
    const emulator = getEmulator();

    if (
      !emulator?.storage?.states ||
      typeof emulator.storage.states.get !== 'function'
    ) {
      return null;
    }

    return toUint8Array(await emulator.storage.states.get(getBaseFileName() + '.state'));
  };

  const getArtifactBytes = (artifact) => {
    if (!artifact) {
      return null;
    }

    if (artifact.dataBytes) {
      return toUint8Array(artifact.dataBytes);
    }

    return null;
  };

  const persistArtifactBytes = async (gameId, kind, slot, fileName, value) => {
    const bytes = toUint8Array(value);

    if (!bytes || bytes.byteLength === 0) {
      return false;
    }

    await persistSaveArtifact({
      dataBytes: bytes,
      fileName,
      gameId,
      id: getSaveArtifactId(gameId, kind, slot),
      kind,
      sizeBytes: bytes.byteLength,
      slot,
      updatedAt: new Date().toISOString(),
    });

    return true;
  };

  const saveLocalStateArtifact = async (gameId, state) => {
    const bytes = toUint8Array(state);

    if (!bytes) {
      displayEmulatorMessage('Failed to save state');
      return;
    }

    await persistLocalState(bytes);

    try {
      await persistArtifactBytes(
        gameId,
        'state',
        getStateSlot(),
        getBaseFileName() + '-' + getStateSlot() + '.state',
        bytes
      );

      displayEmulatorMessage('State saved on this device');
    } catch (error) {
      console.warn('Unable to save local state', error);
      displayEmulatorMessage('Could not save state');
    }
  };

  const loadLocalStateArtifact = async (gameId) => {
    const emulator = getEmulator();
    const slot = getStateSlot();

    if (!emulator?.gameManager) {
      displayEmulatorMessage('State is not ready');
      return;
    }

    try {
      const artifact = await getSaveArtifact(gameId, 'state', slot);
      const bytes = getArtifactBytes(artifact) || (await loadLocalState());

      if (!bytes) {
        displayEmulatorMessage('No save state found');
        return;
      }

      emulator.gameManager.loadState(bytes);
      displayEmulatorMessage('State loaded');
    } catch (error) {
      console.warn('Unable to load save state', error);
      displayEmulatorMessage('Could not load state');
    }
  };

  const saveLocalBattery = async (gameId, save, quiet) => {
    try {
      await persistArtifactBytes(
        gameId,
        'battery',
        'default',
        getBatterySaveFileName(),
        save
      );

      if (!quiet) {
        displayEmulatorMessage('Save file saved on this device');
      }
    } catch (error) {
      console.warn('Unable to save local save file', error);

      if (!quiet) {
        displayEmulatorMessage('Could not save save file');
      }
    }
  };

  const loadLocalBattery = async (gameId, quiet) => {
    try {
      const artifact = await getSaveArtifact(gameId, 'battery', 'default');
      const bytes = getArtifactBytes(artifact);

      if (!bytes) {
        if (!quiet) {
          displayEmulatorMessage('No local save file found');
        }

        return;
      }

      const loaded = writeBatterySaveToCore(bytes);

      if (!quiet) {
        displayEmulatorMessage(
          loaded ? 'Save file loaded' : 'Save file is not ready'
        );
      }
    } catch (error) {
      console.warn('Unable to load save file', error);

      if (!quiet) {
        displayEmulatorMessage('Could not load save file');
      }
    }
  };

  const canUseRotatedPhoneView = () => {
    return (
      isTouchControlDevice() ||
      window.matchMedia('(max-width: 820px)').matches ||
      window.matchMedia('(max-aspect-ratio: 3/4)').matches
    );
  };

  const postParentAction = (action, payload) => {
    if (window.parent === window) {
      return;
    }

    window.parent.postMessage(
      Object.assign({
        action,
        type: 'emuarcade:runner-action',
      }, payload || {}),
      '*'
    );
  };

  const shareCurrentState = async (game) => {
    const emulator = getEmulator();

    if (!emulator?.gameManager || typeof emulator.gameManager.getState !== 'function') {
      displayEmulatorMessage('Save state is not ready');
      return;
    }

    try {
      const bytes = toUint8Array(emulator.gameManager.getState());

      if (!bytes || bytes.byteLength === 0) {
        displayEmulatorMessage('Could not capture save state');
        return;
      }

      const previewDataUrl = await capturePresentedFrame();

      await saveLocalStateArtifact(game.id, bytes);
      postParentAction('share-state', { previewDataUrl, state: bytes });
      displayEmulatorMessage('Checkpoint ready to share');
    } catch (error) {
      console.warn('Unable to capture shared save state', error);
      displayEmulatorMessage('Could not capture save state');
    }
  };

  const clearSharedStateLoadRetry = () => {
    if (sharedStateLoadRetryTimer !== null) {
      window.clearTimeout(sharedStateLoadRetryTimer);
      sharedStateLoadRetryTimer = null;
    }
  };

  const schedulePendingSharedStateRetry = () => {
    if (
      !pendingSharedState ||
      sharedStateLoadRetryTimer !== null ||
      stopped
    ) {
      return;
    }

    sharedStateLoadRetryTimer = window.setTimeout(() => {
      sharedStateLoadRetryTimer = null;
      void applyPendingSharedState();
    }, 400);
  };

  const waitForSharedStateFrame = () => {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        resolve();
      };
      const timeoutId = window.setTimeout(finish, 100);

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(finish);
      });
    });
  };

  async function applyPendingSharedState() {
    const emulator = getEmulator();
    const bytes = pendingSharedState;

    if (sharedStateLoadInProgress) {
      return false;
    }

    if (
      !currentGame ||
      !bytes ||
      !emulator?.gameManager ||
      typeof emulator.gameManager.loadState !== 'function'
    ) {
      schedulePendingSharedStateRetry();
      return false;
    }

    sharedStateLoadInProgress = true;

    try {
      try {
        await persistLocalState(bytes);
        await persistArtifactBytes(
          currentGame.id,
          'state',
          getStateSlot(),
          getBaseFileName() + '-' + getStateSlot() + '.state',
          bytes
        );
      } catch (error) {
        console.warn('Unable to cache shared save state locally', error);
      }

      emulator.gameManager.loadState(bytes);
      await waitForSharedStateFrame();
      pendingSharedState = null;
      sharedStateLoadFailures = 0;
      clearSharedStateLoadRetry();
      pauseForSharedCheckpoint();
      displayEmulatorMessage('Shared checkpoint ready');
      postParentAction('shared-state-loaded');
      return true;
    } catch (error) {
      console.warn('Unable to load shared save state', error);
      sharedStateLoadFailures += 1;

      if (sharedStateLoadFailures < 5) {
        displayEmulatorMessage('Waiting for shared checkpoint...');
        schedulePendingSharedStateRetry();
      } else {
        pendingSharedState = null;
        clearSharedStateLoadRetry();
        displayEmulatorMessage('Could not load shared checkpoint');
        postParentAction('shared-state-error');
      }

      return false;
    } finally {
      sharedStateLoadInProgress = false;
    }
  }

  const clipButtonState = {
    mode: 'manual',
    rollingBufferActive: false,
    state: 'idle',
  };

  const getClipMenuButtons = () => {
    return Array.from(
      document.querySelectorAll('button, [role="button"], .ejs_menu_button')
    ).filter((element) => {
      const label = (
        element.getAttribute('aria-label') ||
        element.getAttribute('title') ||
        element.textContent ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim();

      return label === 'Clip' || label.endsWith(' Clip');
    });
  };

  const updateClipMenuButtons = () => {
    const isManualRecording =
      clipButtonState.mode === 'manual' &&
      clipButtonState.state === 'recording';
    const isRollingReady =
      clipButtonState.mode === 'rolling' && clipButtonState.rollingBufferActive;
    const isRollingWaiting =
      clipButtonState.mode === 'rolling' && !clipButtonState.rollingBufferActive;

    getClipMenuButtons().forEach((button) => {
      button.classList.toggle('emuarcade-clip-recording', isManualRecording);
      button.classList.toggle('emuarcade-clip-rolling-ready', isRollingReady);
      button.classList.toggle('emuarcade-clip-rolling-waiting', isRollingWaiting);

      if (isManualRecording) {
        button.setAttribute('title', 'Stop recording');
      } else if (isRollingReady) {
        button.setAttribute('title', 'Save last 10 seconds');
      } else if (isRollingWaiting) {
        button.setAttribute('title', 'Rolling buffer warming up');
      } else {
        button.setAttribute('title', 'Clip');
      }
    });
  };

  window.addEventListener('message', (event) => {
    if (
      event.source !== window.parent ||
      (event.origin !== window.location.origin && event.origin !== 'null')
    ) {
      return;
    }

    const data = event.data;

    if (!data) {
      return;
    }

    if (data.type === 'emuarcade:load-shared-state') {
      const bytes = toUint8Array(data.state);

      if (bytes && bytes.byteLength > 0) {
        clearSharedStateLoadRetry();
        sharedStateLoadFailures = 0;
        pendingSharedState = bytes;
        void applyPendingSharedState();
      }

      return;
    }

    if (data.type === 'emuarcade:resume-shared-state') {
      resumeSharedCheckpoint();
      return;
    }

    if (data.type !== 'emuarcade:clip-state') {
      return;
    }

    clipButtonState.mode = data.mode === 'rolling' ? 'rolling' : 'manual';
    clipButtonState.rollingBufferActive = Boolean(data.rollingBufferActive);
    clipButtonState.state =
      typeof data.state === 'string' ? data.state : 'idle';
    updateClipMenuButtons();
  });

  const startClipButtonObserver = () => {
    if (!document.body) {
      return;
    }

    const observer = new MutationObserver(updateClipMenuButtons);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    updateClipMenuButtons();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startClipButtonObserver, {
      once: true,
    });
  } else {
    startClipButtonObserver();
  }

  const getEmuArcadeButtons = (game) => {
    const buttons = {
      emuarcadeClip: {
        callback: () => postParentAction('clip'),
        displayName: 'Clip',
        icon: clipIcon,
      },
      emuarcadeTouchControls: {
        callback: () => {
          void openTouchEditor(game);
        },
        displayName: 'Edit Touch Controls',
        icon: touchControlsIcon,
      },
      emuarcadeShareState: {
        callback: () => {
          void shareCurrentState(game);
        },
        displayName: 'Share State',
        icon: shareStateIcon,
      },
    };

    if (canUseRotatedPhoneView()) {
      buttons.emuarcadeRotate = {
        callback: () => postParentAction('rotate'),
        displayName: 'Rotate View',
        icon: rotateIcon,
      };
    }

    return buttons;
  };

  const setEmulatorVolume = (volume) => {
    const emulator = getEmulator();

    if (emulator && typeof emulator.setVolume === 'function') {
      emulator.setVolume(volume);
    }
  };

  const pauseEmulator = (reason) => {
    const emulator = getEmulator();

    if (reason === 'ownership') {
      pausedForOwnership = true;
    }

    if (!emulator) {
      return;
    }

    setEmulatorVolume(0);

    if (
      emulator.started &&
      !emulator.paused &&
      typeof emulator.pause === 'function'
    ) {
      emulator.pause(true);

      if (reason === 'lifecycle') {
        pausedForLifecycle = true;
      }
    }
  };

  const pauseForClipReview = () => {
    const emulator = getEmulator();

    if (
      emulator &&
      emulator.started &&
      !emulator.paused &&
      typeof emulator.pause === 'function'
    ) {
      emulator.pause();
    }
  };

  window.emuarcadePause = pauseForClipReview;

  const pauseForSharedCheckpoint = () => {
    pausedForSharedState = true;
    pauseEmulator('shared-state');
  };

  const resumeSharedCheckpoint = () => {
    if (!pausedForSharedState) {
      return;
    }

    claimActiveRunner();
    pausedForSharedState = false;
    const emulator = getEmulator();

    if (
      !emulator ||
      pausedForOwnership ||
      document.visibilityState === 'hidden'
    ) {
      return;
    }

    setEmulatorVolume(sessionSettings.muted ? 0 : sessionSettings.volume);

    if (emulator.paused && typeof emulator.play === 'function') {
      emulator.play(true);
    }
  };

  window.emuarcadeResumeSharedState = resumeSharedCheckpoint;

  const resumeEmulator = () => {
    const emulator = getEmulator();

    if (
      !emulator ||
      pausedForOwnership ||
      pausedForSharedState ||
      document.visibilityState === 'hidden'
    ) {
      return;
    }

    setEmulatorVolume(sessionSettings.muted ? 0 : sessionSettings.volume);

    if (pausedForLifecycle && typeof emulator.play === 'function') {
      emulator.play(true);
    }

    pausedForLifecycle = false;
  };

  const handleActiveRunner = (activeRunnerId) => {
    if (!activeRunnerId) {
      return;
    }

    if (activeRunnerId === runnerInstanceId) {
      pausedForOwnership = false;
      resumeEmulator();
      return;
    }

    pauseEmulator('ownership');
  };

  const claimActiveRunner = () => {
    try {
      window.localStorage.setItem(activeRunnerStorageKey, runnerInstanceId);
    } catch (error) {
      console.warn('Unable to claim active runner in storage', error);
    }

    if (runnerChannel) {
      runnerChannel.postMessage({
        type: 'active-runner',
        runnerId: runnerInstanceId,
      });
    }

    handleActiveRunner(runnerInstanceId);
  };

  const setupActiveRunnerChannel = () => {
    if (typeof BroadcastChannel === 'undefined') {
      return;
    }

    runnerChannel = new BroadcastChannel(runnerChannelName);
    runnerChannel.onmessage = (event) => {
      const payload = event.data;

      if (
        payload &&
        typeof payload === 'object' &&
        payload.type === 'active-runner' &&
        typeof payload.runnerId === 'string'
      ) {
        handleActiveRunner(payload.runnerId);
      }
    };
  };

  const stopEmulator = () => {
    if (stopped) {
      return;
    }

    stopped = true;
    pausedForOwnership = true;
    pausedForSharedState = false;
    clearSharedStateLoadRetry();
    pauseEmulator('ownership');

    const emulator = getEmulator();

    if (
      emulator &&
      emulator.started &&
      typeof emulator.callEvent === 'function'
    ) {
      emulator.callEvent('exit');
    }

    objectUrls.forEach((url) => URL.revokeObjectURL(url));

    if (runnerChannel) {
      runnerChannel.close();
      runnerChannel = null;
    }
  };

  window.emuarcadeStop = stopEmulator;

  const createBlobUrl = (blob) => {
    const url = URL.createObjectURL(blob);
    objectUrls.push(url);

    return url;
  };

  const getGameId = () => {
    return new URL(document.URL).searchParams.get('id');
  };

  const openDatabase = async () => {
    return await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);

      request.onupgradeneeded = () => {
        const database = request.result;

        if (!database.objectStoreNames.contains(storeName)) {
          const store = database.createObjectStore(storeName, {
            keyPath: 'id',
          });
          store.createIndex('updatedAt', 'updatedAt');
          store.createIndex('core', 'core');
        }

        if (!database.objectStoreNames.contains(saveArtifactStoreName)) {
          const store = database.createObjectStore(saveArtifactStoreName, {
            keyPath: 'id',
          });
          store.createIndex('gameId', 'gameId');
          store.createIndex('updatedAt', 'updatedAt');
        }

        if (!database.objectStoreNames.contains(touchLayoutStoreName)) {
          database.createObjectStore(touchLayoutStoreName, { keyPath: 'core' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error || new Error('Unable to open game library'));
    });
  };

  const readLocalRecord = async (recordStoreName, key) => {
    const database = await openDatabase();

    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(recordStoreName, 'readonly');
        const store = transaction.objectStore(recordStoreName);
        const request = store.get(key);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () =>
          reject(request.error || new Error('Unable to load local record'));
      });
    } finally {
      database.close();
    }
  };

  const writeLocalRecord = async (recordStoreName, value) => {
    const database = await openDatabase();

    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(recordStoreName, 'readwrite');
        const store = transaction.objectStore(recordStoreName);

        store.put(value);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () =>
          reject(transaction.error || new Error('Unable to save local record'));
      });
    } finally {
      database.close();
    }
  };

  const getGame = async (id) => {
    const database = await openDatabase();

    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(id);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () =>
          reject(request.error || new Error('Unable to load game'));
      });
    } finally {
      database.close();
    }
  };

  const loadEmulatorScript = async () => {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');

      script.src = emulatorDataPath + 'loader.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Unable to load EmulatorJS'));
      document.body.appendChild(script);
    });
  };

  const normalizeSettings = (settings) => {
    return Object.assign({}, defaultSettings, settings || {});
  };

  const boot = async () => {
    setupActiveRunnerChannel();
    claimActiveRunner();

    const gameId = getGameId();

    if (!gameId) {
      setStatus('No game selected.', true);
      return;
    }

    const game = await getGame(gameId);

    if (!game || !(game.romBlob instanceof Blob)) {
      setStatus('This game was not found in the local library.', true);
      return;
    }

    currentGame = game;

    const settings = normalizeSettings(game.settings);
    sessionSettings = settings;
    const gameUrl = createBlobUrl(game.romBlob);
    const biosUrl =
      game.biosBlob instanceof Blob ? createBlobUrl(game.biosBlob) : null;

    setStatus('Loading ' + game.title + '...');

    Object.assign(window, {
      EJS_player: '#game',
      EJS_gameName: game.title,
      EJS_gameID: game.id,
      EJS_gameUrl: gameUrl,
      EJS_biosUrl: biosUrl || undefined,
      EJS_core: game.core,
      EJS_pathtodata: emulatorDataPath,
      EJS_pathToData: emulatorDataPath,
      EJS_language: 'en-US',
      EJS_disableAutoLang: true,
      EJS_startOnLoaded: settings.startOnLoad,
      EJS_startButtonName: 'Start EmuArcade',
      EJS_volume: settings.muted ? 0 : settings.volume,
      EJS_threads: settings.threads,
      EJS_color: '#ff4500',
      EJS_backgroundColor: '#05070d',
      EJS_Buttons: getEmuArcadeButtons(game),
      EJS_ready: () => {
        const emulator = getEmulator();

        if (emulator && typeof emulator.on === 'function') {
          emulator.on('saveSaveFiles', (save) => {
            void saveLocalBattery(game.id, save, true);
          });
        }

        void loadAndApplyTouchLayout(game);
      },
      EJS_onGameStart: () => {
        window.setTimeout(() => {
          void loadLocalBattery(game.id, true);
          void loadAndApplyTouchLayout(game).then(() => {
            void maybeStartTouchSetup(game);
          });
          void applyPendingSharedState();
        }, 500);
      },
      EJS_onLoadSave: () => {
        void loadLocalBattery(game.id, false);
      },
      EJS_onLoadState: () => {
        void loadLocalStateArtifact(game.id);
      },
      EJS_onSaveSave: (payload) => {
        void saveLocalBattery(game.id, payload?.save, false);
      },
      EJS_onSaveState: (payload) => {
        void saveLocalStateArtifact(game.id, payload?.state);
      },
      EJS_defaultOptions: {
        shader: settings.shader,
        retroarch_core: settings.n64Core,
        rewindEnabled: settings.rewind ? 'enabled' : 'disabled',
        'virtual-gamepad': settings.virtualGamepad ? 'enabled' : 'disabled',
      },
    });

    await loadEmulatorScript();

    if (pausedForOwnership || document.visibilityState === 'hidden') {
      pauseEmulator(pausedForOwnership ? 'ownership' : 'lifecycle');
    } else {
      resumeEmulator();
    }

    window.setTimeout(hideStatus, 1200);
  };

  postParentAction('runner-ready');

  window.addEventListener('storage', (event) => {
    if (
      event.key === activeRunnerStorageKey &&
      typeof event.newValue === 'string'
    ) {
      handleActiveRunner(event.newValue);
    }
  });

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      pauseEmulator('lifecycle');
    } else {
      claimActiveRunner();
      resumeEmulator();
    }
  });

  window.addEventListener('pagehide', () => pauseEmulator('lifecycle'));
  window.addEventListener('pageshow', () => {
    claimActiveRunner();
    resumeEmulator();
  });
  window.addEventListener('pointerdown', claimActiveRunner, true);
  window.addEventListener('keydown', claimActiveRunner, true);
  window.addEventListener('beforeunload', stopEmulator);
  window.addEventListener('unload', stopEmulator);

  boot().catch((error) => {
    console.error(error);
    setStatus(
      error instanceof Error
        ? error.message
        : 'The emulator could not be started.',
      true
    );
  });
})();
