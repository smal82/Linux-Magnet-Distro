const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn, execFile } = require('child_process');
const os = require('os');
const url = require('url');
const crypto = require('crypto');
const xml2js = require('xml2js');

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
    const remoteUrl = 'https://raw.githubusercontent.com/smal82/Linux-Magnet-Distro/main/package.json';
    const parsedUrl = new URL(remoteUrl);

    const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
            'User-Agent': 'ElectronApp-LinuxMagnetDistro/1.0 (https://github.com/smal82/Linux-Magnet-Distro)' // User-Agent personalizzato per la richiesta remota
        }
    };

    https.get(options, (res) => {
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

// Modificata per accettare un parametro che indica se è un controllo manuale
function checkVersionAndPrompt(isManualCheck = false) {
    const localVersion = getLocalVersion();
    if (!localVersion) {
        if (isManualCheck) {
            dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'Errore Versione Locale',
                message: 'Impossibile determinare la versione locale dell\'applicazione.',
                buttons: ['OK']
            });
        }
        return;
    }

    getRemoteVersion((error, remoteVersion) => {
        if (error) {
            console.error("Impossibile controllare aggiornamenti", error);
            if (isManualCheck) {
                dialog.showMessageBox(mainWindow, {
                    type: 'error',
                    title: 'Errore Aggiornamento',
                    message: 'Impossibile controllare la disponibilità di aggiornamenti. Verifica la tua connessione.',
                    buttons: ['OK']
                });
            }
            return;
        }

        if (remoteVersion && remoteVersion > localVersion) {
            dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Aggiornamento Disponibile',
                message: `È disponibile una nuova versione (${remoteVersion}). Vuoi scaricarla?`,
                buttons: ['Si', 'No']
            }).then(result => {
                if (result.response === 0) {
                    shell.openExternal('https://github.com/smal82/Linux-Magnet-Distro/releases');
                }
            });
        } else if (isManualCheck) { // Mostra questo alert solo se è un controllo manuale
            dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Aggiornamento',
                message: 'La tua applicazione è già aggiornata all\'ultima versione.',
                buttons: ['OK']
            });
        }
    });
}

// Funzione per creare e modificare il menu dell'applicazione
function createApplicationMenu() {
    const localVersion = getLocalVersion();

    // Ottieni il template del menu predefinito di Electron.
    // Questo include le voci standard come File, Edit, View, Window, Help (o i loro equivalenti localizzati).
    // È più sicuro partire da questo template e modificarlo.
    const defaultTemplate = Menu.getApplicationMenu() ? Menu.getApplicationMenu().items : [];

    // Crea un nuovo template di menu basato su quello predefinito
    const customTemplate = defaultTemplate.map(item => {
        // Se l'elemento è il menu 'Help' o 'Aiuto', lo modifichiamo
        if (item.role === 'help' || item.label === 'Help' || item.label === 'Aiuto') {
            return {
                label: item.label,
                submenu: [
                    ...item.submenu.items.map(subItem => ({ ...subItem.submenu ? { submenu: subItem.submenu.items } : {}, ...subItem })), // Copia le voci esistenti del sottomenu
                    { type: 'separator' }, // Aggiungi un separatore
                    {
                        label: 'Informazioni su Linux Magnet Distro',
                        click: () => {
                            dialog.showMessageBox(mainWindow, {
                                type: 'info',
                                title: 'Informazioni',
                                message: `Linux Magnet Distro\nVersione: ${localVersion || 'Sconosciuta'}\n\nUn'applicazione per trovare e scaricare distribuzioni Linux via magnet link.`,
                                buttons: ['OK']
                            });
                        }
                    },
                    {
                        label: 'Controlla Aggiornamenti',
                        click: () => {
                            checkVersionAndPrompt(true); // Passa true per indicare un controllo manuale
                        }
                    },
                    {
                        label: 'GitHub Repository',
                        click: () => {
                            shell.openExternal('https://github.com/smal82/Linux-Magnet-Distro');
                        }
                    }
                ]
            };
        }
        // Per tutti gli altri elementi del menu, restituiscili come sono
        // Ricostruisci il sottomenu se esiste per evitare problemi di riferimento diretto
        if (item.submenu) {
            return {
                label: item.label,
                role: item.role,
                submenu: item.submenu.items.map(subItem => ({ ...subItem.submenu ? { submenu: subItem.submenu.items } : {}, ...subItem }))
            };
        }
        return { ...item }; // Copia l'elemento per evitare modifiche dirette al template originale
    });

    // Se non c'è un menu 'Help' predefinito (es. su Linux senza global menu o per ruoli specifici), aggiungine uno.
    const hasHelpMenu = customTemplate.some(item => item.role === 'help' || item.label === 'Help' || item.label === 'Aiuto');
    if (!hasHelpMenu) {
        customTemplate.push({
            label: 'Aiuto',
            submenu: [
                {
                    label: 'Informazioni su Linux Magnet Distro',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'Informazioni',
                            message: `Linux Magnet Distro\nVersione: ${localVersion || 'Sconosciuta'}\n\nUn'applicazione per trovare e scaricare distribuzioni Linux via magnet link.`,
                            buttons: ['OK']
                        });
                    }
                },
                {
                    label: 'Controlla Aggiornamenti',
                    click: () => {
                        checkVersionAndPrompt(true);
                    }
                },
                { type: 'separator' },
                {
                    label: 'GitHub Repository',
                    click: () => {
                        shell.openExternal('https://github.com/smal82/Linux-Magnet-Distro');
                    }
                }
            ]
        });
    }

    const menu = Menu.buildFromTemplate(customTemplate);
    Menu.setApplicationMenu(menu);
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
        // La creazione del menu deve avvenire dopo che la finestra è pronta, o altrimenti al `app.whenReady()`
        createApplicationMenu(); // Chiama la funzione per creare/modificare il menu
        checkVersionAndPrompt(false); // Avvia il controllo automatico all'avvio (non manuale)
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
    if (mainWindow === null) createWindow();
});

// Funzione per troncare il testo
function truncateText(text, maxLength) {
    if (typeof text !== 'string') {
        return '';
    }
    if (text.length <= maxLength) {
        return text;
    }
    const cleanText = text.replace(/<\/?[^>]+(>|$)/g, "").replace(/&[^;]+;/g, "");
    if (cleanText.length <= maxLength) {
        return cleanText;
    }
    let truncated = cleanText.substring(0, maxLength);
    const lastSpaceIndex = truncated.lastIndexOf(' ');
    if (lastSpaceIndex > (maxLength * 0.75)) {
        truncated = truncated.substring(0, lastSpaceIndex);
    }
    return truncated + '...';
}

// Funzione per rimuovere i BBCode [magnet=...]...[/magnet] dal testo
function cleanMagnetBBCode(text) {
    if (typeof text !== 'string') return "";
    const regex = /\[magnet=([^\]]*)\](.*?)\[\/magnet\]/gis;
    return text.replace(regex, '');
}

ipcMain.handle('fetch-feed', async () => {
    try {
        const feedUrl = 'https://smal82.netsons.org/feed/distros/';
        const parsedFeedUrl = new URL(feedUrl);

        const options = {
            hostname: parsedFeedUrl.hostname,
            path: parsedFeedUrl.pathname + parsedFeedUrl.search,
            method: 'GET',
            headers: {
                'User-Agent': 'ElectronApp-LinuxMagnetDistro/1.0 (https://github.com/smal82/Linux-Magnet-Distro)'
            }
        };

        const response = await new Promise((resolve, reject) => {
            https.get(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(data));
                res.on('error', reject);
            }).on('error', reject);
        });

        const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false, mergeAttrs: true });
        const result = await parser.parseStringPromise(response);

        let items = result.rss.channel.item;
        if (!Array.isArray(items)) {
            items = [items];
        }

        const processedItems = items.slice(0, 20).map(item => {
            let excerptContent = '';
            if (item.description && item.description._) {
                excerptContent = item.description._;
            } else if (typeof item.description === 'string') {
                excerptContent = item.description;
            }

            if (!excerptContent || excerptContent.trim().length < 10) {
                if (item['content:encoded'] && item['content:encoded']._) {
                    excerptContent = item['content:encoded']._;
                } else if (typeof item['content:encoded'] === 'string') {
                    excerptContent = item['content:encoded'];
                }
                excerptContent = truncateText(excerptContent, 250);
            }

            excerptContent = cleanMagnetBBCode(excerptContent);

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
