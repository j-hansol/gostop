// 앱 아이콘(build/icon.png, 1024x1024)을 카드 SVG로 만든다.
// 실행: npx electron tools/make-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const card = fs.readFileSync(path.join(root, 'public/cards/0.svg'), 'utf8');
const html = `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:1024px;height:1024px;display:flex;align-items:center;justify-content:center">
  <div style="width:880px;height:880px;border-radius:200px;
    background:radial-gradient(ellipse at center,#2a7a49 0%,#1d5e37 45%,#0f3a21 100%);
    display:flex;align-items:center;justify-content:center">
    <div style="width:430px;height:668px;transform:rotate(-8deg);
      filter:drop-shadow(0 18px 24px rgba(0,0,0,.45))">${card.replace('<svg ', '<svg width="430" height="668" ')}</div>
  </div>
</div></body></html>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024, height: 1024, show: false, transparent: true, frame: false,
    useContentSize: true, paintWhenInitiallyHidden: true,
  });
  setTimeout(() => { console.error('timeout'); app.exit(1); }, 20000);
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build/icon.png'), img.resize({ width: 1024, height: 1024 }).toPNG());
  console.log('build/icon.png', img.getSize());
  app.quit();
});
