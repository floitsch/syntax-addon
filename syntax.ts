import "google-apps-script";

import docs = GoogleAppsScript.Document;
type Document = docs.Document;
type Body = docs.Body;
type Container = docs.ContainerElement;
type Paragraph = docs.Paragraph;
type Element = docs.Element;
type Table = docs.Table;
type TableCell = docs.TableCell;
type Text = docs.Text;

const CODE_COLOR = "#ffecec"

class CodeSegment {
  // Whether the code segment is already boxed.
  // In this case the paragraphs only need a new syntax coloring.
  alreadyInTable : boolean = false;

  paragraphs : Array<Paragraph>;
  constructor(paragraphs : Array<Paragraph>) {
    this.paragraphs = paragraphs;
  }
}

function main() {
  let document = DocumentApp.getActiveDocument();
  let codeSegments = findCodeSegments(document.getBody());
  boxSegments(codeSegments);
}

let defaultWidth = null;

// Returns the default width of a paragraph.
// Only works for elements that aren't nested.
function computeDefaultWidth() : number {
  if (defaultWidth === null) {
    let document = DocumentApp.getActiveDocument();
    let body = document.getBody();
    defaultWidth = body.getPageWidth() - body.getMarginLeft() - body.getMarginRight();
  }
  return defaultWidth;
}

function isCodeTable(table : Table) : boolean {
  if (table.getNumRows() != 1 || table.getRow(0).getNumCells() != 1) return false;
  let cell = table.getCell(0, 0);
  if (cell.getBackgroundColor() != CODE_COLOR) return false;
  for (let i = 0; i < cell.getNumChildren(); i++) {
    if (cell.getChild(i).getType() != DocumentApp.ElementType.PARAGRAPH) return false;
  }
  return true;
}

function codeSegmentFromCodeTable(table : Table) : CodeSegment {
  let paras : Array<Paragraph> = [];
  let cell = table.getCell(0, 0);
  for (let i = 0; i < cell.getNumChildren(); i++) {
    let para = cell.getChild(i).asParagraph();
    if (para === undefined) throw "Must be paragraph";
    paras.push(para);
  }
  let codeSegment = new CodeSegment(paras);
  codeSegment.alreadyInTable = true;
  return codeSegment;
}

function findCodeSegmentsInTable(table : Table) : Array<CodeSegment> {
  let result : Array<CodeSegment> = [];
  for (let i = 0; i < table.getNumRows(); i++) {
    let row = table.getRow(i);
    for (let j = 0; j < row.getNumCells(); j++) {
      let cell = row.getCell(j);
      let segments = findCodeSegments(cell);
      result.push(...segments);
    }
  }
  return result;
}

function findCodeSegments(container : Body | TableCell) : Array<CodeSegment> {
  let result : Array<CodeSegment> = []
  let inCodeSegment = false;
  let accumulated : Array<Paragraph> = [];

  function finishCodeSegment() {
    result.push(new CodeSegment(accumulated));
    accumulated = [];
    inCodeSegment = false;
  }

  for (let i = 0; i < container.getNumChildren(); i++) {
    let element = container.getChild(i);
    if (inCodeSegment && element.getType() != DocumentApp.ElementType.PARAGRAPH) {
      finishCodeSegment();
    }
    if (element.getType() == DocumentApp.ElementType.TABLE) {
      let table = element.asTable();
      if (isCodeTable(table)) {
        result.push(codeSegmentFromCodeTable(table));
      } else {
        let nested = findCodeSegmentsInTable(element.asTable());
        result.push(...nested);
      }
    }
    if (element.getType() != DocumentApp.ElementType.PARAGRAPH) continue;

    let paragraph = element.asParagraph();
    // Color wins over text.

    let text = paragraph.getText()
    // TODO(florian): is there a way to split a paragraph into smaller pieces
    // by replacing one "\r" with "\n" (for example)?
    if (text.startsWith("```")) {
      if (inCodeSegment) {
        accumulated.push(paragraph);
        finishCodeSegment();
      } else {
        inCodeSegment = true;
      }
    }
    if (inCodeSegment) {
      accumulated.push(paragraph)
      let lines = text.split("\r");
      if (lines.length > 1 && lines[lines.length - 1].startsWith("```")) {
        finishCodeSegment();
      }
    }
  }
  if (accumulated.length != 0) {
    result.push(new CodeSegment(accumulated));
  }
  return result;
}

function insertTableAt(parent : Element, index : number) : Table {
  if (parent.getType() == DocumentApp.ElementType.BODY_SECTION) {
    return parent.asBody().insertTable(index);
  }
  if (parent.getType() == DocumentApp.ElementType.TABLE_CELL) {
    return parent.asTableCell().insertTable(index);
  }
  // This should not happen.
  // Let's just assume there is an insert-table.
  return (parent as any).insertTable(index);
}

function moveParagraphsIntoTables(paras : Array<Paragraph>) {
  let firstParagraph = paras[0];
  let parent = firstParagraph.getParent();
  let index = parent.getChildIndex(firstParagraph);
  let table = insertTableAt(parent, index);
  let cell = table.appendTableRow().appendTableCell()

  let minStart = 999999;

  for (let para of paras) {
    let start = para.getIndentStart();
    if (start === null) minStart = null;
    if (minStart !== null && start < minStart) minStart = start;
  }

  for (let para of paras) {
    para.removeFromParent();
    cell.appendParagraph(para);
    if (minStart !== null) {
      // Remove the indentation. We will indent the table instead.
      para.setIndentStart(para.getIndentStart() - minStart);
      para.setIndentFirstLine(para.getIndentFirstLine() - minStart);
    }
    // No need to change the right indentation, since it's absolute and
    // thus works in the table.
  }

  // Remove the automatically inserted empty paragraph.
  cell.removeChild(cell.getChild(0));

  if (minStart !== null && minStart !== 0) {
    // We can't change the indentation of tables in Google Apps Script.
    // As a work-around we create another invisible table. It's an ugly hack, but
    //   unfortunately seems to be the only way.
    let indentTable = insertTableAt(parent, index);
    let attributes = indentTable.getAttributes();
    attributes["BORDER_WIDTH"] = 0;
    indentTable.setAttributes(attributes);

    let row = indentTable.appendTableRow();
    row.appendTableCell().setWidth(minStart);
    let secondCell = row.appendTableCell();
    secondCell
        .setPaddingTop(0)
        .setPaddingBottom(0)
        .setPaddingLeft(0)
        .setPaddingRight(0);
    secondCell.setWidth(computeDefaultWidth() - minStart - 2);
    table.removeFromParent();
    secondCell.appendTable(table);
    // Tables seem to require a lines around a table. Add a second one and change
    // their size to 0.
    secondCell.appendParagraph("");
    secondCell.getChild(0).asParagraph().editAsText().setFontSize(0);
    secondCell.getChild(2).asParagraph().editAsText().setFontSize(0);
    console.log(secondCell.getNumChildren());
  }
}

function boxSegments(segments : Array<CodeSegment>) {
  for (let segment of segments) {
    if (!segment.alreadyInTable) moveParagraphsIntoTables(segment.paragraphs)
    let cell = segment.paragraphs[0].getParent().asTableCell();
    cell.setBackgroundColor("#ffecec");
    for (let para of segment.paragraphs) {
      para.editAsText().setFontFamily("Roboto Mono");
    }
  }
}
