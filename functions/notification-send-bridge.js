/**
 * @fileoverview Optional hook to MS-189's send path. When notification-send.js
 * is not on the branch yet, callers get null and skip real sends.
 */

/**
 * @return {?Function} tellPerson from notification-send, or null
 */
function loadTellPerson() {
  try {
    return require("./notification-send").tellPerson;
  } catch (err) {
    return null;
  }
}

module.exports = {
  loadTellPerson,
};
