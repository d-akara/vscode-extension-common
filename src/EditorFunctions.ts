'use strict';
import * as vscode from 'vscode'
import { MarkdownString } from 'vscode';
let orderby = require('lodash.orderby');
export interface lineInfo {
    line: vscode.TextLine;
    range: vscode.Range;
}
export function makeRangeFromFoldingRegion(document: vscode.TextDocument, lineNumber: number, tabSize: number) {
    let endLineNumber = lineNumber;
    const endFoldLine = findNextLineDownSameSpacingOrLeft(document, lineNumber, tabSize);
    if (endFoldLine) endLineNumber = endFoldLine.lineNumber;
    return new vscode.Range(lineNumber, 0, endLineNumber, 0);
}

export function findNextLineDownSameSpacingOrLeft(document: vscode.TextDocument, lineNumber: number, tabSize: number) {
    const line = document.lineAt(lineNumber);
    const documentLength = document.lineCount;
    let lastSpacing = calculateLineSpacing(line.text, tabSize);
    for(let index = lineNumber + 1; index < documentLength; index++) {
        const nextLine = document.lineAt(index);
        if ( !nextLine.isEmptyOrWhitespace ) {
            const currentSpacing = calculateLineSpacing(nextLine.text, tabSize);
            if (currentSpacing <= lastSpacing) return nextLine;
        }
    }
    return null;    
}

export function isNextLineDownSpacedRight(document: vscode.TextDocument, lineNumber: number, tabSize: number) {
    const line = document.lineAt(lineNumber);
    const documentLength = document.lineCount;
    let lastSpacing = calculateLineSpacing(line.text, tabSize);
    for(let index = lineNumber + 1; index < documentLength; index++) {
        const nextLine = document.lineAt(index);
        if ( !nextLine.isEmptyOrWhitespace ) {
            const currentSpacing = calculateLineSpacing(nextLine.text, tabSize);
            return (currentSpacing > lastSpacing); 
        }
    }
    return null;    
}

export function findAllLinesSpacedOneLevelRight(document: vscode.TextDocument, lineNumber: number, tabSize: number) {
    const line = document.lineAt(lineNumber);
    const documentLength = document.lineCount;
    const parentLineSpacing = calculateLineSpacing(line.text, tabSize);
    const foundLines = <vscode.TextLine[]>[];

    const nextLineDown = findNextLineDown(document, lineNumber, line=>!line.isEmptyOrWhitespace);
    const childSpacing = calculateLineSpacing(nextLineDown.text, tabSize);
    if (childSpacing <= parentLineSpacing) return foundLines;


    for(let index = lineNumber + 1; index < documentLength; index++) {
        const nextLine = document.lineAt(index);
        if ( !nextLine.isEmptyOrWhitespace ) {
            const currentSpacing = calculateLineSpacing(nextLine.text, tabSize);
            if (currentSpacing <= parentLineSpacing) break;
            if (currentSpacing == childSpacing)
                foundLines.push(nextLine);
        }
    }
    return foundLines;    
}

/**
 * Returns selected text on a single line, or word under cursor if no selection.
 * If multiline selected, returns empty string
 * @param document 
 * @param selection 
 */
export function textOfLineSelectionOrWordAtCursor(document: vscode.TextDocument, selection: vscode.Selection) {
    if (!selection.isSingleLine) return '';
    let range;
    if (selection.isEmpty) {
        range = document.getWordRangeAtPosition(new vscode.Position(selection.anchor.line, selection.anchor.character));
    } 
    if (!range) range = selection as vscode.Range;
    return document.getText(range);
}

export function makeRegExpToMatchWordUnderCursorOrSelection(document: vscode.TextDocument, selection: vscode.Selection) {
    let range = selection as vscode.Range;
    if (selection.isEmpty) {
        range = document.getWordRangeAtPosition(new vscode.Position(selection.anchor.line, selection.anchor.character));
        return new RegExp('\\b' + document.getText(range) + '\\b');
    } 
    return new RegExp(document.getText(range));
}

export function findAllLineNumbersContaining(document: vscode.TextDocument, text: RegExp) {
    let lineNumbers = Array<number>();
    for (let index = 0; index < document.lineCount; index++) {
        const line = document.lineAt(index);
        if (line.text.search(text) > -1) lineNumbers.push(line.lineNumber);
    }
    return lineNumbers;
}

export function calculateLineLevel(textEditor: vscode.TextEditor, lineNumber: number) {
    let level = 1;
    let nextLine = findNextLineUpSpacedLeft(textEditor, lineNumber);
    while(nextLine) {
        level++;
        nextLine = findNextLineUpSpacedLeft(textEditor, nextLine.lineNumber);
    }
    return level;
}

export function findLinesByLevelToRoot(textEditor: vscode.TextEditor, lineNumber: number) {
    const lines = [textEditor.document.lineAt(lineNumber)];
    let nextLine = findNextLineUpSpacedLeft(textEditor, lineNumber);
    while(nextLine) {
        lines.push(nextLine);
        nextLine = findNextLineUpSpacedLeft(textEditor, nextLine.lineNumber);
    }
    return lines;
}

export function findNextLineUpSpacedLeft(textEditor: vscode.TextEditor, lineNumber: number) {
    const line = textEditor.document.lineAt(lineNumber);
    const tabSize = +textEditor.options.tabSize;
    let lastSpacing = calculateLineSpacing(line.text, tabSize);
    for(let index = lineNumber; index >= 0; index--) {
        const line = textEditor.document.lineAt(index);
        if ( !line.isEmptyOrWhitespace ) {
            const currentSpacing = calculateLineSpacing(line.text, tabSize);
            if (currentSpacing < lastSpacing) return line;
        }
    }
    return null;
}

export function findAllLinesContainingCurrentWordOrSelection() {
    const textEditor = vscode.window.activeTextEditor;
    const selection = textEditor.selection;
    const regExForFold = makeRegExpToMatchWordUnderCursorOrSelection(textEditor.document, selection);
    return findAllLineNumbersContaining(textEditor.document, regExForFold);
}

export function calculateLineSpacing(lineText: string, tabSize: number): number {
    let spacing = 0;
    for(let index = 0; index < lineText.length; index++) {
        if (lineText.charAt(index) === ' ') spacing++;
        else if (lineText.charAt(index) === '\t') spacing += tabSize - spacing % tabSize;
        else break;
    }
    return spacing;
}

export function calculateColumnFromCharIndex(lineText: string, charIndex: number, tabSize: number): number {
    let spacing = 0;
    for(let index = 0; index < charIndex; index++) {
        if (lineText.charAt(index) === '\t') spacing += tabSize - spacing % tabSize;
        else spacing++;
    }
    return spacing;
}

export function calculateCharIndexFromColumn(lineText: string, column: number, tabSize: number): number {
    let spacing = 0;
    for(let index = 0; index <= column; index++) {
        if (spacing >= column) return index;
        if (lineText.charAt(index) === '\t') spacing += tabSize - spacing % tabSize;
        else spacing++;
    }
    return spacing;
}

export function triggerWordHighlighting() {
    // Move the cursor so that vscode will reapply the word highlighting
    vscode.commands.executeCommand('cursorLeft');
    vscode.commands.executeCommand('cursorRight');
}

export function linesFromRanges(document: vscode.TextDocument, ranges: Array<vscode.Range>) {
    return ranges.map( range => linesFromRange(document, range) ).reduce( (acc, cur) => acc.concat(cur));
}

export function linesFromRange(document: vscode.TextDocument, range: vscode.Range) {
    const startLine = range.start.line;
    const endLine = range.end.line;

    return collectLines(document, startLine, endLine);
}

export function expandRangeFullLineWidth(document: vscode.TextDocument, range: vscode.Range) {
    return new vscode.Range(range.start.line, 0, range.end.line, document.lineAt(range.end.line).text.length);
}

export function textFromLines(document: vscode.TextDocument, lines: Array<vscode.TextLine>) {
    return lines.map(line=>line.text).reduce((text, lineText)=> text+lineText+'\n','')
}

export function replace(textEditor: vscode.TextEditor, range: vscode.Range, blockText: string) {
    textEditor.edit(function (editBuilder) {
        editBuilder.replace(range, blockText);
    });
}

export function reverseLines(textEditor: vscode.TextEditor, ranges: Array<vscode.Range>) {
    if(ranges.length === 1) {
        const linesToReverse = linesFromRange(textEditor.document, expandRangeToBlockIfEmpty(textEditor, ranges[0]));
        const reversedLines = linesToReverse.slice(0);
        linesToReverse.reverse();
        replaceLines(textEditor, linesToReverse, reversedLines);
    } else {
        const linesToReverse = linesFromRanges(textEditor.document, ranges);
        const reversedLines = linesToReverse.slice(0);
        linesToReverse.reverse();
        replaceLines(textEditor, linesToReverse, reversedLines);
    }
};

export function replaceLines(textEditor: vscode.TextEditor, linesOld: Array<vscode.TextLine>, linesNew: Array<vscode.TextLine>) {
    replaceLinesWithText(textEditor, linesOld, linesNew.map(line=>line.text));
}

export function replaceLinesWithText(textEditor: vscode.TextEditor, linesOld: Array<vscode.TextLine>, linesNew: Array<string>) {
    textEditor.edit(function (editBuilder) {
        let lineIndex = 0;
        linesOld.forEach(line => {
            editBuilder.replace(line.range, linesNew[lineIndex]);
            lineIndex++;
        });
    })
}

export function makeRangesFromCombined(textEditor: vscode.TextEditor, rangesLinesSource: Array<vscode.Range>, rangesCharPosSource: Array<vscode.Range>) {
    const newRanges = [];
    let lineIndex = 0;
    rangesLinesSource.forEach(rangeLineSource => {
        const ranchCharSource = rangesCharPosSource[lineIndex];
        newRanges.push(new vscode.Range(new vscode.Position(rangeLineSource.start.line, ranchCharSource.start.character), new vscode.Position(rangeLineSource.end.line, ranchCharSource.end.character)));
        lineIndex++;
    });

    return newRanges;
}

export function collectLines(document: vscode.TextDocument, startLine: number, endLine: number): Array<vscode.TextLine> {
    const lines = [];
    for (let index = startLine; index <= endLine; index++) {
        lines.push(document.lineAt(index));
    }
    return lines;
}

export function filterLines(document: vscode.TextDocument, range: vscode.Range, filter:(lineText: string) => boolean) {
    const filteredLines:Array<vscode.TextLine> = [];

    const totalLines = (range.end.line - range.start.line) + 1
    for(let lineIndex = range.start.line; lineIndex < totalLines; lineIndex++) {

        const line = document.lineAt(lineIndex);
        if (filter(line.text)) {
            filteredLines.push(line);
        }
    }
    return filteredLines;
}

export function textFromRangeOrCursorToEndLine(text: string, range: vscode.Range) {
    if (range.isSingleLine && range.start.character === range.end.character)
        // select to end of line if range does not span characters
        return text.substring(range.start.character, text.length);
    return text.substring(range.start.character, range.end.character);
} 

export function textsFromRanges(document: vscode.TextDocument, ranges: vscode.Range[]) {
    return ranges.map(range=>{
        return document.getText(range);
    })
} 

export function expandRangeDocumentIfEmpty(textEditor: vscode.TextEditor, range: vscode.Range) {
    if (range.isSingleLine && range.start.character === range.end.character) {
        return makeRangeDocument(textEditor.document);
    }
    return range;
}

export function makeRangeDocument(document: vscode.TextDocument) {
    const rangeLastLine = document.lineAt(document.lineCount - 1).range.end;
    return new vscode.Range(new vscode.Position(0,0), new vscode.Position(rangeLastLine.line, rangeLastLine.character));
}

export function makeRangeFromLineToEnd(document: vscode.TextDocument, lineStart:number) {
    const rangeLastLine = document.lineAt(document.lineCount - 1).range.end;
    return new vscode.Range(new vscode.Position(lineStart,0), new vscode.Position(rangeLastLine.line, rangeLastLine.character));
}

export function findNextLineDown(document: vscode.TextDocument, lineNumber: number, stopWhen: (line: vscode.TextLine)=> boolean) {
    const line = document.lineAt(lineNumber);
    const documentLength = document.lineCount;
    for(let index = lineNumber + 1; index < documentLength; index++) {
        const nextLine = document.lineAt(index);
        if (stopWhen(nextLine)) return nextLine;
    }
    return null;    
}

export function findNextLineUp(document: vscode.TextDocument, lineNumber: number, stopWhen: (line: vscode.TextLine)=> boolean) {
    const line = document.lineAt(lineNumber);
    for(let index = lineNumber - 1; index >= 0; index--) {
        const nextLine = document.lineAt(index);
        if (stopWhen(nextLine)) return nextLine;
    }
    return null;    
}

export function findLastLineOfBlock(document: vscode.TextDocument, lineNumber: number, isInBlock: (line: vscode.TextLine)=> boolean) {
    const line = document.lineAt(lineNumber);
    let previousLine = line;
    const documentLength = document.lineCount;
    for(let index = lineNumber + 1; index < documentLength; index++) {
        const nextLine = document.lineAt(index);
        if (!isInBlock(nextLine)) break;
        previousLine = nextLine;
    }
    return previousLine;    
}

export function findFirstLineOfBlock(document: vscode.TextDocument, lineNumber: number, isInBlock: (line: vscode.TextLine)=> boolean) {
    const line = document.lineAt(lineNumber);
    let previousLine = line;
    for(let index = lineNumber - 1; index >= 0; index--) {
        const nextLine = document.lineAt(index);
        if (!isInBlock(nextLine)) break;
        previousLine = nextLine;
    }
    return previousLine;    
}

export function expandRangeToBlockIfEmpty(textEditor: vscode.TextEditor, range: vscode.Range) {
    if (range.isSingleLine && range.start.character === range.end.character) {

        const firstLineOfBlock = findFirstLineOfBlock(textEditor.document, range.start.line, line => !line.isEmptyOrWhitespace);
        const lastLineOfBlock = findLastLineOfBlock(textEditor.document, range.start.line, line => !line.isEmptyOrWhitespace);
        return new vscode.Range(new vscode.Position(firstLineOfBlock.lineNumber,0), new vscode.Position(lastLineOfBlock.lineNumber, lastLineOfBlock.range.end.character));
    }
    return range;
}

export function makeVerticalRangesWithinBlock(textEditor: vscode.TextEditor, ranges: vscode.Range[]) {
    if (ranges.length > 1) return ranges;

    const range = ranges[0];
    if (range.isSingleLine && range.start.character === range.end.character) {

        const firstLineOfBlock = findFirstLineOfBlock(textEditor.document, range.start.line, line => !line.isEmptyOrWhitespace);
        const lastLineOfBlock = findLastLineOfBlock(textEditor.document, range.start.line, line => !line.isEmptyOrWhitespace);
        const cursorColumn = calculateColumnFromCharIndex(textEditor.document.lineAt(range.start.line).text, range.start.character, +textEditor.options.tabSize);

        const ranges:vscode.Range[] = [];
        for(let lineIndex = firstLineOfBlock.lineNumber; lineIndex <= lastLineOfBlock.lineNumber; lineIndex++) {
            const line = textEditor.document.lineAt(lineIndex);
            const charIndex = calculateCharIndexFromColumn(line.text, cursorColumn,  +textEditor.options.tabSize);
            ranges.push(new vscode.Range(new vscode.Position(line.lineNumber,charIndex), new vscode.Position(line.lineNumber, charIndex)));
        }
        return ranges;
    }
    return [range];
}

export function makeSelectionsFromRanges(ranges: vscode.Range[]) {
    return ranges.map(range=>new vscode.Selection(range.start.line, range.start.character,range.start.line, range.start.character))
}

export function sortLinesWithinRange(textEditor: vscode.TextEditor, range: vscode.Range) {
    const lines = linesFromRange(textEditor.document, range);
    const sortedLines = orderby(lines, ['text'], null, null);

    replaceLines(textEditor, lines, sortedLines);
}

export function sortLinesByLength(textEditor: vscode.TextEditor, lines: vscode.TextLine[]) {
    const sortedLines = orderby(lines, ['text.length'], null, null);
    replaceLines(textEditor, lines, sortedLines);
}

export function sortLinesByColumn(textEditor: vscode.TextEditor, ranges: Array<vscode.Range>) {
    const lines = makeLineInfos(textEditor, ranges);
    
    const sortedLines = orderby(lines, [line => textFromRangeOrCursorToEndLine(line.line.text, line.range)], null, null);

    replaceLines(textEditor, lines.map(line => line.line), sortedLines.map(line => line.line));
    const updatedRanges = makeRangesFromCombined(textEditor, lines.map(line => line.range), sortedLines.map(line => line.range));
    textEditor.selections = updatedRanges.map(range => new vscode.Selection(range.start, range.end));
}

export function makeLineInfos(textEditor: vscode.TextEditor, ranges: Array<vscode.Range>) {
    const lineAndCursors: Map<number, lineInfo> = new Map();
    for(const range of ranges) {
        const line = textEditor.document.lineAt(range.start.line);
        let lineAndCursor = lineAndCursors.get(line.lineNumber);
        if (!lineAndCursor) lineAndCursor = {line, range};

        lineAndCursors.set(line.lineNumber, lineAndCursor);
    }
    return Array.from(lineAndCursors.values());
}

export function createGutterDecorator(lineNumber:number, contentText:string, width:string) {
    const posStart = new vscode.Position(lineNumber,0);
    
    return {
        range: new vscode.Range(posStart, posStart), 
        renderOptions: {
            before: {contentText, width, backgroundColor: new vscode.ThemeColor('editor.lineHighlightBackground'), color: new vscode.ThemeColor('badge.foreground')} 
        }
        //hoverMessage: hoverMessage
    };
}

export function addMarkdownCommandLink(markdownString:MarkdownString, linkName:string, commandId:string, parameters:object) {
    const uri = encodeURI('command:'+commandId+'?' + JSON.stringify(parameters))
    markdownString.appendMarkdown('['+linkName+']('+uri+')');
    markdownString.isTrusted = true;
    return markdownString;
}

export function promptForFilterExpression(defaultValue:string):Thenable<(lineText: string) => boolean> {
    return vscode.window.showInputBox({value: defaultValue, prompt: 'Enter regex or [space] + literal'})
        .then(filter => {
            let fnFilter;
            if (filter.charAt(0) === ' ') fnFilter = (lineText:string) => lineText.includes(filter.substring(1));
            else {
                const regex = new RegExp(filter, 'i');
                fnFilter = (lineText:string) => regex.test(lineText);
            }
            return fnFilter;
        })
}

/**
 * Open new document if not already open.
 * Show document in next editor group
 * @param name 
 * @param content 
 * @param preserveFocus 
 */
export function openShowDocument(name: string, content: string, preserveFocus=true) {
    const nextColumn = vscode.window.activeTextEditor.viewColumn === 3 ? 2 : 1 + vscode.window.activeTextEditor.viewColumn
    return vscode.workspace.openTextDocument(vscode.Uri.parse('untitled:'+name))
        .then(document => vscode.window.showTextDocument(document, nextColumn, preserveFocus))
        .then(editor=> {
            replace(editor, makeRangeDocument(editor.document), content)
            return editor;
        })
}

/**
 * Returns promise which resolves to current selections if exist and non empty
 * else attempts to create selections from current match results
 * @param textEditor
 */
export function selectionsOrMatchesAsSelections(textEditor: vscode.TextEditor) {
    const originalSelections = textEditor.selections;
    if ((originalSelections.length > 1) || !textEditor.selection.isEmpty) return Promise.resolve(originalSelections);
    return matchesAsSelections(textEditor)
}

export function matchesAsSelections(textEditor: vscode.TextEditor) {
    const originalSelections = textEditor.selections;
    return vscode.commands.executeCommand('editor.action.selectAllMatches')
          .then(()=> {
              const matchSelections = textEditor.selections.slice(0, textEditor.selections.length);
              textEditor.selections = originalSelections;
              return matchSelections;
            })
}

export function selectionsOrMatchesAsSelectionsOrDocument(textEditor: vscode.TextEditor) {
    return selectionsOrMatchesAsSelections(textEditor).then(selections=> {
        if (selections.length === 1 && selections[0].isEmpty) {
            const documentRange = makeRangeDocument(textEditor.document);
            return [new vscode.Selection(documentRange.start, documentRange.end)];
        }
        return selections;
    })
}

export function visibleTextEditorFromDocument(document:vscode.TextDocument) {
    return vscode.window.visibleTextEditors.find(editor=>editor.document===document)
}