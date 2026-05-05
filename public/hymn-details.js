/**
 * @fileoverview Frontend logic for displaying detailed information about a specific hymn.
 * Handles fetching hymn data, rendering details, and managing clipboard actions.
 */

document.addEventListener('DOMContentLoaded', () => {
  const hymnDetailsContainer = document.getElementById('hymn-details-container');
  const urlParams = new URLSearchParams(window.location.search);
  const hymnId = urlParams.get('id');

  const loadHymn = () => {
    if (hymnId) {
      const db = firebase.firestore();
      const hymnRef = db.collection('hymns').doc(hymnId);

      hymnRef.get().then(doc => {
        if (doc.exists) {
          const hymn = doc.data();
          renderHymnDetails(hymn);
        } else {
          hymnDetailsContainer.innerHTML = '<p>Hymn not found.</p>';
        }
      }).catch(error => {
        console.error("Error getting document:", error);
        hymnDetailsContainer.innerHTML = '<p>Error loading hymn.</p>';
      });
    } else {
      hymnDetailsContainer.innerHTML = '<p>No hymn ID provided.</p>';
    }
  };

  // If already signed in, just load the hymn. Otherwise sign in anonymously first.
  if (firebase.auth().currentUser) {
    loadHymn();
  } else {
    firebase.auth().signInAnonymously().then(() => {
      loadHymn();
    }).catch((error) => {
      console.error("Error signing in anonymously:", error);
      hymnDetailsContainer.innerHTML = '<p>Error authenticating.</p>';
    });
  }


  /**
   * Renders the hymn's details into the DOM.
   * @param {Object} hymn - The hymn data object from Firestore.
   */
  function renderHymnDetails(hymn) {
    let html = `
      <div class="mb-md text-center">
          <h1 class="font-display-lg text-display-lg text-primary mb-sm">${hymn.hymn_name}</h1>
      </div>
      <div class="flex justify-center gap-4 mb-lg">
        <button id="copy-attribution" class="bg-surface-container-lowest border border-outline-variant text-on-surface font-label-md text-label-md px-6 py-3 rounded-DEFAULT hover:bg-surface-container-low transition-colors flex items-center gap-2">
            <span class="material-symbols-outlined text-[20px]">content_copy</span>
            <span>Copy Attribution</span>
        </button>
      </div>
    `;

    if (hymn.versions && hymn.versions.length > 0) {
        hymn.versions.forEach(version => {
            html += `
            <div class="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-md mb-lg">
                <h2 class="font-headline-md text-headline-md text-primary mb-md pb-xs border-b border-surface-variant">${version.name}</h2>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-md">
            `;
            const pages = version.pages;
            if (pages) {
                pages.forEach((pageUrl, index) => {
                    html += `
                    <div class="flex flex-col items-center bg-surface-container-lowest border border-outline-variant rounded-lg p-sm">
                        <p class="font-label-md text-label-md text-on-surface-variant mb-sm">Page ${index + 1}</p>
                        <img src="${pageUrl}" alt="Page ${index + 1}" class="w-full object-contain bg-white border border-surface-variant rounded-sm mb-sm" style="max-height: 60vh;">
                        <button class="download-image bg-secondary text-on-secondary font-label-md text-label-md px-4 py-2 rounded-DEFAULT hover:bg-primary transition-colors flex items-center gap-2 w-full justify-center" data-url="${pageUrl}" data-hymn="${hymn.hymn_name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}" data-version="${version.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}" data-page="${index + 1}">
                            <span class="material-symbols-outlined text-[18px]">download</span>
                            <span>Download Image</span>
                        </button>
                    </div>
                    `;
                });
            }
            html += `</div></div>`;
        });
    }

    hymnDetailsContainer.innerHTML = html;

    document.getElementById('copy-attribution').addEventListener('click', (e) => {
      const button = e.currentTarget;
      copyToClipboard(hymn.attribution, button);
    });

    document.querySelectorAll('.download-image').forEach(button => {
      button.addEventListener('click', (e) => {
        const imageUrl = e.currentTarget.dataset.url;
        const buttonElem = e.currentTarget;
        const filename = `${buttonElem.dataset.hymn}_${buttonElem.dataset.version}_page_${buttonElem.dataset.page}.png`;
        downloadImage(imageUrl, buttonElem, filename);
      });
    });
  }

  /**
   * Copies the provided text to the system clipboard.
   * @param {string} text - The text to copy.
   * @param {HTMLElement} button - The button element to provide visual feedback.
   */
  function copyToClipboard(text, button) {
    if (!text) {
        const originalHtml = button.innerHTML;
        button.innerHTML = '<span class="material-symbols-outlined text-[20px]">error</span><span>No Attribution</span>';
        setTimeout(() => {
            button.innerHTML = originalHtml;
        }, 2000);
        return;
    }

    navigator.clipboard.writeText(text).then(() => {
      const originalHtml = button.innerHTML;
      button.innerHTML = '<span class="material-symbols-outlined text-[20px]">check</span><span>Copied!</span>';
      button.classList.add('bg-surface-container-high');
      setTimeout(() => {
        button.innerHTML = originalHtml;
        button.classList.remove('bg-surface-container-high');
      }, 2000);
    }, (err) => {
      console.error('Could not copy text: ', err);
      const originalHtml = button.innerHTML;
      button.innerHTML = '<span class="material-symbols-outlined text-[20px]">error</span><span>Error</span>';
      setTimeout(() => {
        button.innerHTML = originalHtml;
      }, 2000);
    });
  }

  /**
   * Fetches an image from a URL and triggers a download.
   * @param {string} imageUrl - The URL of the image to download.
   * @param {HTMLElement} button - The button element to provide visual feedback.
   * @param {string} filename - The suggested filename for the download.
   */
  async function downloadImage(imageUrl, button, filename) {
    try {
      const url = new URL(imageUrl);
      // Append time to bypass cache if needed
      url.searchParams.append('time', new Date().getTime());
      const response = await fetch(url);
      const blob = await response.blob();
      
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);

      const originalHtml = button.innerHTML;
      button.innerHTML = '<span class="material-symbols-outlined text-[18px]">check</span><span>Downloaded!</span>';
      button.classList.add('bg-primary-container');
      setTimeout(() => {
        button.innerHTML = originalHtml;
        button.classList.remove('bg-primary-container');
      }, 2000);
    } catch (err) {
      console.error('Could not download image: ', err);
      const originalHtml = button.innerHTML;
      button.innerHTML = '<span class="material-symbols-outlined text-[18px]">error</span><span>Error</span>';
      setTimeout(() => {
        button.innerHTML = originalHtml;
      }, 2000);
    }
  }
});