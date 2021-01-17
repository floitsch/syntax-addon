/**
 * @OnlyCurrentDoc
 */
// Copyright (C) 2021 Florian Loitsch. All rights reserved.

import "google-apps-script";
import slides = GoogleAppsScript.Slides;
import * as theme from "../theme/theme";

declare var codemirror;

type Slide = slides.Slide;
type Shape = slides.Shape;
type TextRange = slides.TextRange;

class CodeShape {
  shape : Shape;
  mode : string;
  hasBackticks : boolean;

  constructor(shape : Shape, mode : string, hasBackticks : boolean) {
    this.shape = shape;
    this.mode = mode;
    this.hasBackticks = hasBackticks;
  }
}

const MODE_TO_STYLE : Map<string, theme.SegmentStyle> = new Map();
const COLOR_TO_MODE : Map<string, string> = new Map();

for (let mode of theme.themer.getModeList()) {
  let segmentStyle = theme.themer.getSegmentStyle(mode);
  let color = segmentStyle.background;
  // We don't want to deal with different casing later on.
  COLOR_TO_MODE.set(color.toLowerCase(), mode);
  COLOR_TO_MODE.set(color.toUpperCase(), mode);
  MODE_TO_STYLE.set(mode, segmentStyle);
  /*
  // There is no way to pass a parameter from the menu to a function.
  // We therefore dynamically create individual functions that can be used
  // as targets.
  let self : any = this;
  self[changeColorNameFor(mode)] = function() {
    changeColorTo(mode);
  }
  */
}

function main() {
  let pres = SlidesApp.getActivePresentation();
  let slides = pres.getSlides();
  for (let slide of slides) {
    doSlide(slide);
  }
}

function doSlide(slide) {
  // It's important that we reuse the shapes we get from here, so that
  // the identity function works.
  let shapes = slide.getShapes();
  let codeShapes = findCodeShapes(shapes);
  let codeSet : Set<Shape> = new Set();
  for (let codeShape of codeShapes) {
    codeSet.add(codeShape.shape);
    let mode = codeShape.mode;
    if (!isValidMode(mode)) continue;
    if (codeShape.hasBackticks) {
      removeBackticksAndBox(codeShape);
    }
    colorize(codeShape);
  }
  for (let shape of shapes) {
    if (codeSet.has(shape)) continue;
    colorizeSpans(shape);
  }
}

function isValidMode(mode : string) : boolean {
  return MODE_TO_STYLE.get(mode) !== undefined;
}

function modeFromColor(color : string) : string {
  return COLOR_TO_MODE.get(color) || "<unknown>";
}

function findCodeShapes(shapes : Array<Shape>) : Array<CodeShape> {
  let result : Array<CodeShape> = [];
  for (let shape of shapes) {
    if (shape.getShapeType() != SlidesApp.ShapeType.TEXT_BOX) continue;
    let background = shape.getFill().getSolidFill();
    if (background) {
      // If the text box has some background color we assume it's a
      // code shape. We will skip it, if it doesn't have a color we
      // recognize.
      let mode = modeFromColor(background.getColor().asRgbColor().asHexString());
      result.push(new CodeShape(shape, mode, false));
      continue;
    }
    let str = shape.getText().asString();
    if (str.startsWith("```") &&
        (str.endsWith("\n```") || str.endsWith("\n```\n"))) {
      let firstLine = str.substring(0, str.indexOf("\n"));
      let mode = firstLine.substring(3).trim();  // Skip the triple-quotes.
      if (mode === "") mode = "none";
      result.push(new CodeShape(shape, mode, true));
    }
  }
  return result;
}

function removeBackticksAndBox(codeShape : CodeShape) {
  let shape = codeShape.shape;
  let text = shape.getText();
  let style = MODE_TO_STYLE.get(codeShape.mode);
  shape.getFill().setSolidFill(style.background);
  let textStyle = text.getTextStyle();
  if (style.fontFamily) textStyle.setFontFamily(style.fontFamily);
  // TODO(florian): would be nice if we could get the default color from the
  // template. That said: it's probably ok if the code doesn't use the same color.
  textStyle.setForegroundColor(style.foreground || "#000000");
  textStyle.setBold(style.bold || false);
  textStyle.setItalic(style.italic || false);

  let str = text.asString();
  let endOfFirstLine = str.indexOf('\n');
  let startOfLastLine = str.lastIndexOf('\n```');
  if (endOfFirstLine === startOfLastLine) {
    text.clear();
  } else {
    // First remove the trailing ticks, as removing the leading one changes the positions.
    text.getRange(startOfLastLine, startOfLastLine + 4).clear();
    text.getRange(0, endOfFirstLine + 1).clear();
  }
}

function colorize(codeShape : CodeShape) {
  let shape = codeShape.shape;
  let mode = codeShape.mode;
  let text = shape.getText()
  let str = text.asString();
  let codeMirrorStyle = MODE_TO_STYLE.get(mode);
  let offset = 0;
  codemirror.runMode(str, codeMirrorStyle.codeMirrorMode, function(token, tokenStyle) {
    let range = text.getRange(offset, offset + token.length);
    let style = codeMirrorStyle.codeMirrorStyleToStyle(tokenStyle);
    applyStyle(range, style)
    offset += token.length;
  });
}

class CodeSpan {
  from : number;
  to : number;

  constructor(from : number, to : number) {
    this.from = from;
    this.to = to;
  }
}

function colorizeSpans(shape : Shape) {
  let text = shape.getText();
  if (text.isEmpty()) return;
  let str = text.asString();
  let spans : Array<CodeSpan> = [];
  let currentOffset = -1
  while (currentOffset < str.length) {
    let start = str.indexOf('`', currentOffset);
    if (start === -1) break;
    let end = str.indexOf('`', start + 1);
    if (end === -1) break;
    let newline = str.indexOf('\n', start);
    // We don't allow code spans to go over multiple lines.
    // TODO(florian): maybe we should?
    if (newline < end) {
      currentOffset = newline;
      continue;
    }
    // If we have backticks next to each other, just consume all of them.
    if (start === end - 1) {
      while (str[end] === '`') end++;
      currentOffset = end + 1;
    }
    spans.push(new CodeSpan(start, end));
    currentOffset = end + 1;
  }
  // Handle the spans from the last to the first, so we don't change the positions
  // in the wrong order.
  for (let i = spans.length - 1; i >= 0; i--) {
    let span = spans[i];
    let rangeText = text.asString().substring(span.from + 1, span.to - 1)
    let style = theme.themer.getCodeSpanStyle(rangeText);
    // We change the section with the back-ticks, and then remove the ticks afterwards.
    // This way we never have to deal with empty strings.
    let range = text.getRange(span.from, span.to);
    applyStyle(range, style);
    text.getRange(span.from, span.from + 1).clear();
    text.getRange(span.to - 1, span.to).clear();
  }
}

function applyStyle(range : TextRange, style : theme.Style) {
  if (!style) return;
  let textStyle = range.getTextStyle();
  // We are setting the values, even if they are undefined, to revert them
  // to the default (in case they have been set before).
  if (style.italic !== undefined) textStyle.setItalic(style.italic);
  if (style.bold !== undefined) textStyle.setBold(style.bold);
  if (style.foreground !== undefined) textStyle.setForegroundColor(style.foreground);
  if (style.background !== undefined) textStyle.setBackgroundColor(style.background);
  if (style.fontFamily !== undefined) textStyle.setFontFamily(style.fontFamily);
}