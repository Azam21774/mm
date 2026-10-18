const { randomInt } = require("crypto");
const Mustache = require("mustache");

const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const NUMBERS = "0123456789";

// Tag values are message content, so double-brace variables must not HTML-escape.
Mustache.escape = (value) => String(value ?? "");

function randomCharacters(config = {}) {
  return `${config.alphabets ? LOWERCASE : ""}${config.capital ? UPPERCASE : ""}${config.number ? NUMBERS : ""}`;
}

function generateRandomTag(length, config = {}) {
  if (!Number.isInteger(length) || length < 1 || length > 128) {
    throw new RangeError("Random Tag length must be between 1 and 128.");
  }
  const characters = randomCharacters(config);
  if (!characters) throw new Error("Random Tag requires at least one character set.");

  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += characters[randomInt(characters.length)];
  }
  return value;
}

function renderTagTemplate(template, data) {
  return Mustache.render(String(template ?? ""), data);
}

module.exports = { generateRandomTag, randomCharacters, renderTagTemplate };
