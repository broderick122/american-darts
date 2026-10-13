/* Roslyn American Darts — site config.
   Leave the placeholders in place to use this browser's localStorage.
   Setup steps are in README.md. Do not put the Apps Script admin secret here. */
window.RAD_CONFIG = {
  sheetId: "YOUR_GOOGLE_SHEET_ID",
  scriptUrl: "YOUR_APPS_SCRIPT_WEB_APP_URL",

  /* Only used when scriptUrl is still a placeholder.
     Checked in the browser, so anyone can read it. Not real security.
     The live admin secret belongs in Apps Script → Project Settings → Script properties
     as ADMIN_SECRET, and is never stored in this file. */
  fallbackAdminPasscode: "CHANGE_ME"
};
