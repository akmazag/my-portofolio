/**
 * MEI 1998 — Part 1/10 · Web App (Google Apps Script)
 *
 * Cara pakai:
 * 1. script.google.com → New project.
 * 2. Tempel file ini sebagai Code.gs.
 * 3. File → New → HTML file → beri nama "index" → tempel isi mei1998/index.html.
 * 4. Deploy → New deployment → Web app → Execute as: Me, Access: Anyone → Deploy.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Mei 1998 — Part 1/10')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
