/**
 * What an MCP tool hands back (MS-262, extracted MS-278).
 *
 * Two shapes, and the difference between them matters more than their size. A
 * RESULT is data an assistant reads. A REFUSAL is a sentence an assistant can
 * act on and repeat to the person asking — as against a thrown error, which
 * surfaces to an elder as "something went wrong" and tells them nothing about
 * what to do next.
 *
 * Lifted out of mcp-server.js when the shepherding tools arrived, so the two
 * registration files cannot drift into two slightly different ideas of what a
 * refusal looks like.
 */

/**
 * A tool result carrying JSON.
 *
 * MCP wants content blocks; an assistant reads the text. The data goes in as
 * pretty JSON rather than as a prose summary this file would have to keep in
 * step with the shape.
 *
 * @param {*} data whatever the underlying module returned
 * @return {object} an MCP tool result
 */
function jsonResult(data) {
  return {content: [{type: "text", text: JSON.stringify(data, null, 2)}]};
}

/**
 * A refusal the assistant can read and act on.
 * @param {string} message why not
 * @return {object} an MCP tool result flagged as an error
 */
function refuse(message) {
  return {content: [{type: "text", text: message}], isError: true};
}

module.exports = {jsonResult, refuse};
