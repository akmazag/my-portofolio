/**
 * Code.gs
 * Entry point Web App & helper template.
 * @version 2.0.0
 *
 * Deploy: Deploy → New deployment → Web app
 *   Execute as : Me (pemilik script)      ← wajib, agar user tidak perlu akses ke Sheet/Drive
 *   Who has access: Anyone / Anyone within domain (autentikasi dilakukan oleh aplikasi)
 */

function doGet(e) {
  const out = HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('QC Management System')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
  // Embed (Google Sites / iframe) tetap diizinkan seperti v1.
  // Set Script Property ALLOW_EMBED=false untuk mencegah clickjacking bila tidak di-embed.
  const allowEmbed = PropertiesService.getScriptProperties().getProperty('ALLOW_EMBED') !== 'false';
  return out.setXFrameOptionsMode(allowEmbed ? HtmlService.XFrameOptionsMode.ALLOWALL : HtmlService.XFrameOptionsMode.DEFAULT);
}

/** <?!= include('NamaFile'); ?> */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Health check. */
function apiPing() {
  return { ok: true, data: { version: APP_VERSION, timestamp: new Date().toISOString() } };
}
