import DOMPurify from './node_modules/dompurify/dist/purify.es.mjs';

const feedContainer = document.getElementById('feed-container');
let refreshButton; // Dichiara refreshButton all'esterno

// Funzione per rimuovere i BBCode [magnet=...]...[/magnet]
function extractMagnetLinks(text) {
  if (!text) {
    return { cleanedText: "", magnetLinks: [] };
  }
  const regex = /\[magnet=([^\]]*)\](.*?)\[\/magnet\]/gs;
  const magnetLinks = [];
  let match;
  let cleanedText = text;

  while ((match = regex.exec(text)) !== null) {
    const magnetAltText = match[1]; // Cattura il testo dopo [magnet=
    const magnetUrl = match[2];   // Cattura il testo tra i tag (che ora ignoreremo per l'alt)
    magnetLinks.push({ altText: magnetAltText, url: magnetUrl });
    cleanedText = cleanedText.replace(match[0], ''); // Sostituisce l'intero blocco con una stringa vuota
  }

  return { cleanedText, magnetLinks };
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

      const titleElement = document.createElement('h2');
      titleElement.textContent = item.title;

      const dateElement = document.createElement('p');
      dateElement.classList.add('date');
      dateElement.textContent = new Date(item.pubDate).toLocaleDateString();

      let processedExcerptResult = item.excerpt ? extractMagnetLinks(item.excerpt) : { cleanedText: "", magnetLinks: [] };
      let processedExcerpt = processedExcerptResult.cleanedText;
      const excerptMagnetLinks = processedExcerptResult.magnetLinks;

      if (processedExcerpt) {
        const excerptElement = document.createElement('p');
        excerptElement.classList.add('excerpt');
        excerptElement.innerHTML = DOMPurify.sanitize(nl2br(processedExcerpt));
        feedItem.appendChild(excerptElement);

        // Crea icone magnet per l'excerpt
        excerptMagnetLinks.forEach(magnetInfo => {
          // Crea un nodo di testo per visualizzare l'altText
          const altTextNode = document.createTextNode(magnetInfo.altText + ' ');
          feedItem.appendChild(altTextNode); // Appendi il testo direttamente al feedItem

          const magnetLinkElement = document.createElement('a');
          magnetLinkElement.href = magnetInfo.url;

          const magnetIcon = document.createElement('img');
          magnetIcon.src = './assets/Magnet-Icon2.png';
          magnetIcon.alt = altTextNode;
          magnetIcon.width = 320;
          magnetIcon.height = 90;
          magnetIcon.style.verticalAlign = 'middle';
          magnetIcon.style.marginRight = '5px';

          magnetLinkElement.appendChild(magnetIcon);
		  feedItem.appendChild(document.createElement('br'));
		  

          feedItem.appendChild(magnetLinkElement);
          feedItem.appendChild(document.createElement('br'));
        });
      }

      const linkElement = document.createElement('a');
      linkElement.href = item.link;
      linkElement.textContent = 'Leggi di più';
      linkElement.target = '_blank';

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