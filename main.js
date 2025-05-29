const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn, execFile } = require('child_process');
const os = require('os');
const url = require('url');
const crypto = require('crypto');
const xml2js = require('xml2js'); // Importa xml2js

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
                    shell.openExternal('https://github.com/smal82/Linux-Magnet-Distro/releases');
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

    mainWindow.on('closed', function () {
        mainWindow = null;
    });

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

// Funzione per troncare il testo (copiata da renderer.js per uso qui)
function truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) {
        return text;
    }
    let truncated = text.substring(0, maxLength);
    truncated = truncated.substring(0, Math.min(truncated.length, truncated.lastIndexOf(' ')));
    return truncated + '...';
}

// Funzione per rimuovere i BBCode [magnet=...]...[/magnet] dal testo
function cleanMagnetBBCode(text) {
    if (!text) return "";
    const regex = /\[magnet=([^\]]*)\](.*?)\[\/magnet\]/gs;
    return text.replace(regex, '');
}

ipcMain.handle('fetch-feed', async () => {
    try {
        const feedUrl = 'https://smal82.netsons.org/feed/distros/';
        const response = await new Promise((resolve, reject) => {
            https.get(feedUrl, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(data));
                res.on('error', reject);
            }).on('error', reject);
        });

        const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false, mergeAttrs: true });
        const result = await parser.parseStringPromise(response);

        const items = result.rss.channel.item;
        if (!Array.isArray(items)) { // Assicura che items sia un array anche se c'è un solo item
            items = [items];
        }

        const processedItems = items.slice(0, 20).map(item => {
            let excerptContent = '';
            // Tenta di prendere il testo da description
            if (item.description && item.description._) { // Se description è un oggetto con _ (CDATA)
                excerptContent = item.description._;
            } else if (typeof item.description === 'string') { // Se description è una stringa diretta
                excerptContent = item.description;
            }

            // Se description è vuoto o non significativo, usa content:encoded e tronca
            if (!excerptContent || excerptContent.trim().length < 10) { // Considera "vuoto" anche se molto corto
                if (item['content:encoded'] && item['content:encoded']._) {
                    excerptContent = item['content:encoded']._;
                } else if (typeof item['content:encoded'] === 'string') {
                    excerptContent = item['content:encoded'];
                }
                // Tronca il contenuto di content:encoded per l'excerpt
                excerptContent = truncateText(excerptContent, 250); // Lunghezza desiderata per l'excerpt
            }

            // Pulisci l'excerpt dai BBCode magnet
            excerptContent = cleanMagnetBBCode(excerptContent);

            // Estrai l'enclosure
            let enclosure = null;
            if (item.enclosure && item.enclosure.url) {
                enclosure = {
                    url: item.enclosure.url,
                    type: item.enclosure.type || null,
                    length: item.enclosure.length || null
                };
            }

            return {
                title: item.title || 'Nessun titolo',
                link: item.link || '#',
                enclosure: enclosure,
                pubDate: item.pubDate || new Date().toISOString(),
                excerpt: excerptContent
            };
        });

        return processedItems;
    } catch (error) {
        console.error("Errore nel fetching o parsing del feed:", error);
        return [];
    }
});
