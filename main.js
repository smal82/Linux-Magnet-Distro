const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Notification } = require('electron');
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

// Variabile per tenere traccia degli ID dei post già notificati per evitare duplicati
// Questo Set verrà popolato con i post "esistenti" all'avvio iniziale.
let notifiedPostIds = new Set(); 

// Variabile di stato per la prima esecuzione del fetch del feed dopo l'avvio
// Sarà true alla prima chiamata di fetchAndNotifyNewPosts per la popolazione iniziale
// e poi false per le chiamate successive (quelle con notifica).
let isInitialFetchComplete = false; 

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
    const defaultTemplate = Menu.getApplicationMenu() ? Menu.getApplicationMenu().items : [];

    // Crea un nuovo template di menu basato su quello predefinito
    const customTemplate = defaultTemplate.map(item => {
        // Se l'elemento è il menu 'Help' o 'Aiuto', lo modifichiamo
        if (item.role === 'help' || item.label === 'Help' || item.label === 'Aiuto') {
            return {
                label: item.label,
                submenu: [
                    // Copia le voci esistenti del sottomenu 'Help'
                    ...(item.submenu && item.submenu.items ? item.submenu.items.map(subItem => ({
                        ...subItem, // Copia le proprietà base
                        // Ricorsivamente gestisci i sottomenu nidificati se esistono
                        ...(subItem.submenu && subItem.submenu.items ? { submenu: subItem.submenu.items.map(nestedSubItem => ({ ...nestedSubItem })) } : {})
                    })) : []),
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
        if (item.submenu && item.submenu.items) {
            return {
                label: item.label,
                role: item.role,
                submenu: item.submenu.items.map(subItem => ({
                    ...subItem,
                    ...(subItem.submenu && subItem.submenu.items ? { submenu: subItem.submenu.items.map(nestedSubItem => ({ ...nestedSubItem })) } : {})
                }))
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

    mainWindow.webContents.on('did-finish-load', async () => {
        // --- Inizio della Logica per Popolazione Iniziale e Polling ---
        // Al caricamento, esegui il fetch iniziale del feed e usalo SOLO per popolare notifiedPostIds.
        console.log('Esecuzione del fetch iniziale per popolare gli ID dei post già esistenti...');
        try {
            const initialPosts = await fetchFeedContent(); // Chiamiamo la funzione che solo fa il fetch
            initialPosts.forEach(post => notifiedPostIds.add(post.link));
            console.log(`Popolati ${notifiedPostIds.size} ID di post esistenti all'avvio.`);
            isInitialFetchComplete = true; // Marca il fetch iniziale come completato
        } catch (error) {
            console.error("Errore durante il fetch iniziale per la popolazione:", error);
        }
        
        createApplicationMenu(); // Chiama la funzione per creare/modificare il menu
        checkVersionAndPrompt(false); // Avvia il controllo automatico all'avvio (non manuale)

        // Imposta un intervallo per il controllo periodico del feed e notifica i nuovi post
        setInterval(() => {
            console.log('Controllo automatico del feed per NUOVI post...');
            fetchAndNotifyNewPosts(); 
        }, 15 * 60 * 1000); // Ogni 15 minuti
        // --- Fine della Logica per Popolazione Iniziale e Polling ---
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

// --- Funzione GENERICA per il fetching del feed senza logica di notifica ---
async function fetchFeedContent() {
    try {
        const feedUrl = 'https://smal82.netsons.org/feed/distros/';
        const parsedUrl = new URL(feedUrl); 

        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
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
}


// --- Funzione per il fetching del feed e la gestione delle notifiche ---
async function fetchAndNotifyNewPosts() {
    try {
        const processedItems = await fetchFeedContent(); // Ottiene i dati del feed

        // Notifica SOLO i post che NON sono già in notifiedPostIds E se il fetch iniziale è completato
        // Questo impedisce le notifiche indesiderate all'avvio.
        const newPosts = processedItems.filter(item => !notifiedPostIds.has(item.link));

        if (newPosts.length > 0 && isInitialFetchComplete) { // Notifica solo se ci sono nuovi post E se l'inizializzazione è finita
            newPosts.forEach(post => {
                if (Notification.isSupported()) {
                    const notification = new Notification({
                        title: `Nuova Distro: ${post.title}`,
                        body: post.excerpt,
                        icon: path.join(__dirname, 'assets', 'favicon.png'),
                    });

                    notification.on('click', () => {
                        console.log('Notifica cliccata, aprendo il link:', post.link);
                        shell.openExternal(post.link);
                    });

                    notification.show();
                } else {
                    console.warn("Le notifiche native non sono supportate sul sistema.");
                }
                notifiedPostIds.add(post.link); // Aggiungi l'ID del post all'elenco dei notificati
            });
            console.log(`Notificate ${newPosts.length} nuove distro.`);
        } else if (newPosts.length === 0) {
            console.log("Nessun nuovo post da notificare.");
        } else if (!isInitialFetchComplete) {
            console.log("Fetch in corso o completato, ma notifiche disabilitate per il fetch iniziale.");
        }

        return processedItems; // Ritorna i dati per chi ha chiamato (es. ipcMain.handle)
    } catch (error) {
        console.error("Errore nel fetching o parsing del feed:", error);
        return [];
    }
}


// IPC handler per il fetching del feed (usato dal renderer process)
ipcMain.handle('fetch-feed', async () => {
    // Quando il renderer chiede il feed, restituisce i dati attuali.
    // La logica di notifica è ora gestita solo dal polling automatico.
    // Il renderer si aspetta solo i dati, non le notifiche dirette dalla sua richiesta.
    return fetchFeedContent(); 
});
