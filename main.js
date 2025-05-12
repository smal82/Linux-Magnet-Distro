const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Parser = require('rss-parser');
const parser = new Parser();

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
	icon: path.join(__dirname, 'assets', 'favicon.png'),
    webPreferences: {
      nodeIntegration: false, // Disabilita nodeIntegration per sicurezza
      contextIsolation: true, // Abilita contextIsolation per contextBridge
      preload: path.join(__dirname, 'preload.js')
    }
  });
  
  

  mainWindow.loadFile('index.html');

  // Apri gli strumenti di sviluppo (opzionale)
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  if (mainWindow === null) createWindow();
});

ipcMain.handle('fetch-feed', async () => {
  try {
    const feed = await parser.parseURL('https://smal82.netsons.org/feed/distros/');
    return feed.items.slice(0, 20).map(item => ({
      title: item.title,
      link: item.link,
      enclosure: item.enclosure,
      pubDate: item.pubDate,
      excerpt: item.description || item['content:encoded'] // Prova entrambi i tag comuni
    }));
  } catch (error) {
    console.error("Errore nel fetching del feed:", error);
    return [];
  }
});