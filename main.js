const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Parser = require('rss-parser');
const parser = new Parser();
const https = require('https');
const { spawn, execFile } = require('child_process');
const os = require('os');
const url = require('url');
const crypto = require('crypto');

let mainWindow;
let tempFilePath;
let downloadProgressDialog;
let installerAttempts = 0;
let tempDir;
let expectedChecksum = null;

// Funzione per ottenere la versione dal package.json locale
function getLocalVersion() {
    try {
        const packageJsonPath = path.join(app.getAppPath(), 'package.json');
        const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
        const packageJson = JSON.parse(packageJsonContent);
        return packageJson.version;
    } catch (error) {
        console.error('Errore durante la lettura del package.json locale:', error);
        return null;
    }
}

// Funzione per ottenere la versione dal package.json della repository GitHub
function getRemoteVersion(callback) {
    const url = 'https://raw.githubusercontent.com/smal82/Linux-Magnet-Distro/main/package.json';
    https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        res.on('end', () => {
            try {
                const remotePackageJson = JSON.parse(data);
                callback(null, remotePackageJson.version);
            } catch (error) {
                console.error('Errore durante l\'analisi del package.json remoto:', error);
                callback(error, null);
            }
        });
        res.on('error', (error) => {
            console.error('Errore durante il recupero del package.json remoto:', error);
            callback(error, null);
        });
    });
}

function checkVersionAndPrompt() {
    const localVersion = getLocalVersion();
    if (!localVersion) {
        return;
    }

    getRemoteVersion((error, remoteVersion) => {
        if (error) {
            console.error("Impossibile controllare aggiornamenti", error);
            return;
        }

        if (remoteVersion && remoteVersion > localVersion) {
            dialog.showMessageBox({
                type: 'info',
                title: 'Aggiornamento Disponibile',
                message: `È disponibile una nuova versione (${remoteVersion}). Vuoi scaricarla?`,
                buttons: ['Si', 'No']
            }).then(result => {
                if (result.response === 0) {
                    // Apri la pagina delle release nel browser predefinito
                    shell.openExternal('https://github.com/smal82/Linux-Magnet-Distro/releases');
                    //app.quit(); // Puoi chiudere l'app dopo aver aperto il browser, se lo desideri
                }
            });
        }
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        icon: path.join(__dirname, 'assets', 'favicon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile('index.html');

    //mainWindow.webContents.openDevTools();

    mainWindow.on('closed', function () {
        mainWindow = null;
    });

    // Controlla la versione all'avvio
    mainWindow.webContents.on('did-finish-load', () => {
        checkVersionAndPrompt();
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
            excerpt: item.description || item['content:encoded']
        }));
    } catch (error) {
        console.error("Errore nel fetching del feed:", error);
        return [];
    }
});
