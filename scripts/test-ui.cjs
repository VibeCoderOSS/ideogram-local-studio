const { app, BrowserWindow } = require("electron");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const rendererPath = path.join(root, "app", "renderer", "index.html");

app.setPath("userData", path.join(root, ".electron-profile-test"));
app.commandLine.appendSwitch("use-mock-keychain");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  await win.loadFile(rendererPath);
  await delay(1200);

  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const qs = (selector) => document.querySelector(selector);
      const click = (selector) => qs(selector).click();
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const assert = (condition, message) => {
        if (!condition) throw new Error(message);
      };

      if (document.body.classList.contains('light-on')) click('#light-button');
      localStorage.removeItem('ideogram-light-mode');

      assert(!qs('.traffic'), 'fake traffic lights are still rendered');
      const brokenImages = [...document.images]
        .filter((img) => img.complete && img.naturalWidth === 0)
        .map((img) => img.getAttribute('src'));
      assert(brokenImages.length === 0, 'broken image assets: ' + brokenImages.join(', '));
      const generationPanel = qs('.generation-panel');
      assert(generationPanel.scrollHeight > generationPanel.clientHeight, 'generation panel is not scrollable');
      generationPanel.scrollTop = 160;
      await wait(50);
      assert(generationPanel.scrollTop > 0, 'generation panel scrollTop did not move');

      click('[data-view="server"]');
      assert(qs('[data-view-panel="server"]').classList.contains('active'), 'server view did not activate');
      assert(qs('#api-curl-snippet').textContent.includes('curl -s -X POST'), 'api curl snippet missing');

      click('[data-view="gallery"]');
      await wait(100);
      assert(qs('[data-view-panel="gallery"]').classList.contains('active'), 'gallery view did not activate');
      assert(qs('#gallery-grid').children.length > 0, 'gallery did not render');
      assert(!qs('.gallery-card strong') && !qs('.gallery-card span'), 'gallery thumbnails still render detail text');
      assert(qs('#gallery-delete'), 'gallery delete button missing');
      assert(qs('#gallery-delete').disabled, 'reference gallery item should not be deletable');
      assert(qs('#gallery-reveal').disabled, 'reference gallery item should not be revealable');

      click('[data-view="settings"]');
      await wait(100);
      assert(qs('[data-view-panel="settings"]').classList.contains('active'), 'settings view did not activate');
      assert(qs('#settings-python').textContent.trim() !== '--', 'settings runtime missing');

      click('[data-view="generation"]');
      click('#clear-prompt');
      assert(qs('#prompt').value === '', 'clear prompt failed');
      assert(qs('#prompt-counter').textContent.startsWith('0'), 'prompt counter failed');

      qs('#prompt').value = 'A ceramic cup on a marble counter';
      qs('#prompt').dispatchEvent(new Event('input', { bubbles: true }));
      click('#enhance-prompt');
      assert(qs('#prompt').value.includes('Ideogram 4 quality'), 'enhance prompt failed');

      const seedBefore = qs('#seed').value;
      click('#random-seed');
      assert(qs('#seed').value !== seedBefore, 'random seed failed');

      click('[data-size="768x768"]');
      assert(qs('#info-size').textContent === '768 x 768', 'size button failed');
      click('[data-ratio="16:9"]');
      assert(qs('#info-size').textContent === '1920 x 1088', 'ratio button failed');
      window.prompt = () => { throw new Error('custom size should not use window.prompt'); };
      window.__lastAlert = '';
      window.alert = (message) => { window.__lastAlert = String(message); };
      click('[data-size="custom"]');
      assert(!qs('#custom-size-row').classList.contains('hidden'), 'custom size controls did not appear');
      qs('#custom-width').value = '640';
      qs('#custom-height').value = '896';
      click('#apply-custom-size');
      assert(qs('#info-size').textContent === '640 x 896', 'custom size did not update info');
      assert(qs('#api-curl-snippet').textContent.includes('"width": 640'), 'custom width missing from api payload');
      assert(qs('#api-curl-snippet').textContent.includes('"height": 896'), 'custom height missing from api payload');
      qs('#custom-width').value = '641';
      click('#apply-custom-size');
      assert(window.__lastAlert.includes('multiples of 16'), 'invalid custom size was not rejected');
      assert(qs('#info-size').textContent === '640 x 896', 'invalid custom size changed current size');

      click('#light-button');
      assert(document.body.classList.contains('light-on'), 'light adjustment failed');
      assert(getComputedStyle(document.body).color === 'rgb(17, 24, 39)', 'light mode did not apply light text color');
      assert(localStorage.getItem('ideogram-light-mode') === '1', 'light mode preference was not persisted');
      click('#collapse-sidebar');
      assert(document.body.classList.contains('sidebar-collapsed'), 'collapse failed');

      click('#favorite-action');
      assert(qs('#favorite-action').classList.contains('active'), 'favorite failed');

      click('#generate-button');
      await wait(560);
      assert(!qs('#overlay-progress').classList.contains('hidden'), 'step progress did not appear');
      assert(qs('#overlay-progress-steps').textContent.includes('offen'), 'remaining steps text missing');
      assert(/^ETA (\\d|\\d+:)/.test(qs('#overlay-progress-eta').textContent), 'ETA was not shown after step 2');
      await wait(800);
      assert(!qs('#generation-overlay').classList.contains('hidden') === false, 'generation overlay did not hide');
      assert(qs('#info-time').textContent !== '--', 'generate did not update info time');

      return {
        activeView: document.querySelector('.nav-item.active').dataset.view,
        infoSize: qs('#info-size').textContent,
        promptLength: qs('#prompt').value.length,
        logLines: qs('#runtime-log').textContent.split('\\n').length
      };
    })();
  `, true);

  console.log(JSON.stringify({ ok: true, result }, null, 2));
  await win.close();
  app.quit();
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
