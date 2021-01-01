// Copyright (C) 2020 Florian Loitsch. All rights reserved.

// So we can import this file in the other libraries.
export {
  FONT_FAMILY,
  SPAN_COLORS,
  MODES,
}

const FONT_FAMILY = "Roboto Mono";
const SPAN_COLORS = [
  [/^[a-zA-Z_0-9<>]+(\/[a-zA-Z_0-9<>]+)+$/, "#3c003c"], // Path.
  [/^(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))$/, "#008c0c"], // Number.
  [/^(["]([^"\\]|[\\]["\\])*["])$/, "#38008c"], // String.
  [/^([']([^"\\]|[\\]['\\])*['])$/, "#38008c"], // String/Char.
  [/^(null|undefined|true|false|nil)$/, "#8c0008"], // Keywords.
  [/^[12]?[0-9]?[0-9](\.[12]?[0-9]?[0-9]){3}$/, "#8c3028"], // IPv4.
  [/.*/, "#000c8c"], // Rest.
];

const MODES = {
  "none" : "#f7f7f7",  // No specified mode.
  "toit" : "#f2f8ff",
  "dart" : "#f7fff7",
  "shell": "#fff7f2",
  "go": "#f7ffff",
  "python": "#f7f7ff",
  "java": {
    color: "#fffff7",
    cm: "text/x-java"
  }
};