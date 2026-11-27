/**
 * MEI 1998 — Web App (Google Apps Script)
 *
 * Cara pakai:
 * 1. script.google.com → New project.
 * 2. Tempel file ini sebagai Code.gs.
 * 3. File → New → HTML file:
 *      "index" → isi mei1998/index.html  (Part 1)
 *      "part2" → isi mei1998/part2.html  (Part 2)
 * 4. Deploy → New deployment → Web app → Execute as: Me, Access: Anyone → Deploy.
 *
 * URL: .../exec        → Part 1
 *      .../exec?part=2 → Part 2
 */
var PARTS = { '1': 'index', '2': 'part2' };

function doGet(e) {
  var part = (e && e.parameter && e.parameter.part) || '1';
  var file = PARTS[part] || PARTS['1'];
  return HtmlService.createHtmlOutputFromFile(file)
    .setTitle('Mei 1998 — Part ' + (PARTS[part] ? part : '1') + '/10')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
