
const { app, BrowserWindow, systemPreferences } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "GuardianDepth AI - 智能跌倒监控",
    backgroundColor: '#050505',
    icon: path.join(__dirname, 'icon.png'), // 请确保根目录下有 icon.png
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  // 生产环境下加载打包后的 index.html
  // 开发环境下可以加载 localhost:3000
  win.loadFile('index.html');

  // 移除默认菜单栏，增强 App 感
  win.setMenuBarVisibility(false);
}

app.whenReady().then(async () => {
  // Windows 下自动检查并请求摄像头权限
  if (process.platform === 'win32') {
    await systemPreferences.askForMediaAccess('camera');
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
