import DOMPurify from './node_modules/dompurify/dist/purify.es.mjs';

const feedContainer = document.getElementById('feed-container');
let refreshButton; // Dichiara refreshButton all'esterno

// Funzione per rimuovere i BBCode [magnet=...]...[/magnet] dal testo
// Non estrae più i link, si limita a pulire il testo.
function extractMagnetLinks(text) {
    if (!text) {
        return "";
    }
    const regex = /\[magnet=([^\]]*)\](.*?)\[\/magnet\]/gs;
    return text.replace(regex, ''); // Rimuove tutti i blocchi [magnet]
}

function nl2br(text) {
    if (!text) {
        return "";
    }
    return text.replace(/\n/g, '<br>');
}

async function fetchAndDisplayFeed() {
    const items = await window.electronAPI.fetchFeed();
    feedContainer.innerHTML = '';

    if (items && items.length > 0) {
        items.forEach(item => {
            const feedItem = document.createElement('div');
            feedItem.classList.add('feed-item');

            // Crea un link per il titolo del post
            const titleLinkElement = document.createElement('a');
            titleLinkElement.href = item.link;
            titleLinkElement.target = '_blank'; // Apri in una nuova scheda/finestra
            const titleElement = document.createElement('h2');
            titleElement.textContent = item.title;
            titleLinkElement.appendChild(titleElement);
            feedItem.appendChild(titleLinkElement);

            const dateElement = document.createElement('p');
            dateElement.classList.add('date');
            dateElement.textContent = new Date(item.pubDate).toLocaleDateString();
            feedItem.appendChild(dateElement);

            // L'excerpt è già stato processato e troncato in main.js
            // Applica solo la pulizia finale dei BBCode e sanitizzazione
            const processedExcerpt = extractMagnetLinks(item.excerpt || ''); // Pulisci eventuali BBCode residui

            if (processedExcerpt) {
                const excerptElement = document.createElement('p');
                excerptElement.classList.add('excerpt');
                excerptElement.innerHTML = DOMPurify.sanitize(nl2br(processedExcerpt));
                feedItem.appendChild(excerptElement);
            }

            // Gestione del tag enclosure: questa è la tua "immagine in evidenza" o il "magnet link"
            if (item.enclosure && item.enclosure.url) {
                const enclosureElement = document.createElement('div');
                enclosureElement.classList.add('enclosure');
                enclosureElement.style.marginTop = '10px';
                enclosureElement.style.marginBottom = '10px';

                // Controlla se l'URL dell'enclosure è un magnet link
                if (item.enclosure.url.startsWith('magnet:?')) {
                    const magnetLinkElement = document.createElement('a');
                    magnetLinkElement.href = item.enclosure.url;
                    // magnetLinkElement.target = '_blank'; // Rimosso come richiesto

                    const magnetIcon = document.createElement('img');
                    magnetIcon.src = './assets/Magnet-Icon2.png';
                    magnetIcon.alt = 'Magnet Link';
                    magnetIcon.width = 320;
                    magnetIcon.height = 90;
                    magnetIcon.style.verticalAlign = 'middle';
                    magnetIcon.style.marginRight = '5px';

                    magnetLinkElement.appendChild(magnetIcon);
                    
                    const magnetText = document.createTextNode(item.title || 'Scarica via Magnet');
                    magnetLinkElement.appendChild(magnetText);

                    enclosureElement.appendChild(magnetLinkElement);
                } else if (item.enclosure.type && item.enclosure.type.startsWith('image/')) {
                    // Se è un'immagine, visualizzala come immagine in evidenza
                    const imgElement = document.createElement('img');
                    imgElement.src = item.enclosure.url;
                    imgElement.alt = 'Immagine in evidenza';
                    imgElement.style.maxWidth = '100%';
                    imgElement.style.height = 'auto';
                    imgElement.style.borderRadius = '8px';
                    enclosureElement.appendChild(imgElement);
                } else {
                    // Altrimenti, visualizza un link generico per il download
                    const linkElement = document.createElement('a');
                    linkElement.href = item.enclosure.url;
                    linkElement.textContent = `Scarica allegato (${item.enclosure.type || 'file'})`;
                    linkElement.target = '_blank';
                    linkElement.classList.add('text-blue-500', 'hover:underline');
                    enclosureElement.appendChild(linkElement);
                }
                feedItem.appendChild(enclosureElement);
            }

            // Aggiungi il link "Leggi di più" per il post originale
            const linkElement = document.createElement('a');
            linkElement.href = item.link;
            linkElement.textContent = 'Leggi l\'articolo.';
            linkElement.target = '_blank';
            linkElement.classList.add('read-more-link');

            feedItem.appendChild(linkElement);
            feedItem.appendChild(document.createElement('br'));

            feedContainer.appendChild(feedItem);
        });
    } else {
        feedContainer.textContent = 'Nessun contenuto trovato.';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    refreshButton = document.getElementById('refresh-button');
    if (refreshButton) {
        refreshButton.addEventListener('click', fetchAndDisplayFeed);
    } else {
        console.error("Elemento con ID 'refresh-button' non trovato nel DOM.");
    }
    fetchAndDisplayFeed(); // Carica il feed iniziale dopo che il DOM è pronto
});
