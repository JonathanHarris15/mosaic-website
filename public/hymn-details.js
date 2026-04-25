document.addEventListener('DOMContentLoaded', () => {
  const hymnDetailsContainer = document.getElementById('hymn-details-container');
  const urlParams = new URLSearchParams(window.location.search);
  const hymnId = urlParams.get('id');

  firebase.auth().signInAnonymously().then(() => {
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
  }).catch((error) => {
    console.error("Error signing in anonymously:", error);
    hymnDetailsContainer.innerHTML = '<p>Error authenticating.</p>';
  });


  function renderHymnDetails(hymn) {
    let html = `<h1 class="hymn-title">${hymn.hymn_name}</h1>`;
    html += `
      <div class="top-buttons">
        <button id="copy-attribution">Copy Attribution</button>
        <button id="update-ltp">Update LTP</button>
      </div>
    `;

    hymn.versions.forEach(version => {
      html += `<div class="version">`;
      html += `<h2>${version.name}</h2>`;
      html += `<div class="pages">`;
      const pages = version.pages;
      if (pages) {
        pages.forEach((pageUrl, index) => {
          html += `
            <div class="page">
              <p>Page ${index + 1}</p>
              <img src="${pageUrl}" alt="Page ${index + 1}">
              <button class="copy-image" data-url="${pageUrl}">Copy Image</button>
            </div>
          `;
        });
      }
      html += `</div></div>`;
    });

    hymnDetailsContainer.innerHTML = html;

    document.getElementById('copy-attribution').addEventListener('click', (e) => {
      const button = e.target;
      copyToClipboard(hymn.attribution, button);
    });

    document.getElementById('update-ltp').addEventListener('click', (e) => {
      const button = e.target;
      updateLastTimePlayed(button);
    });

    document.querySelectorAll('.copy-image').forEach(button => {
      button.addEventListener('click', (e) => {
        const imageUrl = e.target.dataset.url;
        const button = e.target;
        copyImageToClipboard(imageUrl, button);
      });
    });
  }

  function updateLastTimePlayed(button) {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 (Sun) to 6 (Sat)
    const daysUntilSunday = 7 - dayOfWeek;
    const nextSunday = new Date(today);
    nextSunday.setDate(today.getDate() + daysUntilSunday);
    const formattedDate = nextSunday.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });

    const db = firebase.firestore();
    db.collection('hymns').doc(hymnId).update({
      last_played_date: formattedDate
    }).then(() => {
      button.textContent = 'Updated!';
      button.classList.add('copied-feedback');
      setTimeout(() => {
        button.textContent = 'Update LTP';
        button.classList.remove('copied-feedback');
      }, 2000);
    }).catch((error) => {
      console.error("Error updating document: ", error);
      button.textContent = 'Error';
      setTimeout(() => {
        button.textContent = 'Update LTP';
      }, 2000);
    });
  }

  function copyToClipboard(text, button) {
    navigator.clipboard.writeText(text).then(() => {
      button.textContent = 'Copied!';
      button.classList.add('copied-feedback');
      setTimeout(() => {
        button.textContent = 'Copy Attribution';
        button.classList.remove('copied-feedback');
      }, 2000);
    }, (err) => {
      console.error('Could not copy text: ', err);
      button.textContent = 'Error';
      setTimeout(() => {
        button.textContent = 'Copy Attribution';
      }, 2000);
    });
  }

  async function copyImageToClipboard(imageUrl, button) {
    try {
      const url = new URL(imageUrl);
      url.searchParams.append('time', new Date().getTime());
      const response = await fetch(url);
      const blob = await response.blob();

      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = URL.createObjectURL(blob);
      });

      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);

      const pngBlob = await new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/png');
      });

      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': pngBlob
        })
      ]);

      button.textContent = 'Copied!';
      button.classList.add('copied-feedback');
      setTimeout(() => {
        button.textContent = 'Copy Image';
        button.classList.remove('copied-feedback');
      }, 2000);
    } catch (err) {
      console.error('Could not copy image: ', err);
      button.textContent = 'Error';
      setTimeout(() => {
        button.textContent = 'Copy Image';
      }, 2000);
    }
  }
});