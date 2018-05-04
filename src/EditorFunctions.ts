'use strict';
import * as vscode from 'vscode'
import { MarkdownString } from 'vscode';
import * as FS from 'fs'
import * as Path from 'path'
let orderby = require('lodash.orderby');
export const debounce = require('lodash.debounce')

export interface lineInfo {
    line: vscode.TextLine;
    range: vscode.Range;
}
const ICON_PATHS = new Map<string, string>()
const EMPTY_RANGE = new vscode.Range(new vscode.Position(0,0), new vscode.Position(0,1));

export namespace Region {
    export function makeRangeFromFoldingRegion(document: vscode.TextDocument, foldableLineNumber: number, tabSize: number) {
        let endLineNumber = foldableLineNumber;
        const endFoldLine = Lines.findNextLineDownSameSpacingOrLeft(document, foldableLineNumber, tabSize);
        // TODO review 'makeRangeFromFoldingRegionRelativeLevel'.  Should we return next line if current is not foldable.
        // Need to check who uses this function and behavior
        if (endFoldLine) endLineNumber = endFoldLine.lineNumber;
        return new vscode.Range(foldableLineNumber, 0, endLineNumber, 0);
    }

    /**
     * 
     * @param document 
     * @param lineNumber folding range created relative to this line
     * @param relativeLevel number of parent levels to include.  0 = children, 1 = all siblings and children, 2+ parents and their children
     * @param tabSize 
     * @returns range of region.  If relative level results in root, all lines in document returned.
     */
    export function makeRangeFromFoldingRegionRelativeLevel(document: vscode.TextDocument, lineNumber: number, relativeLevel: number, tabSize: number) {
        let line = document.lineAt(lineNumber);
        const documentLength = document.lineCount;

        while (relativeLevel-- >= 0) {
            line = Lines.findNextLineUpSpacedLeft(document, line.lineNumber, tabSize)
            if (!line) return makeRangeDocument(document);
        }

        let endLineNumber = line.lineNumber;
        const endFoldLine = Lines.findNextLineDownSameSpacingOrLeft(document, line.lineNumber, tabSize);
        // If end fold line is not 1 greater than starting line, then there are no children.  Not foldable
        if (endFoldLine && endFoldLine.lineNumber > endLineNumber + 1) endLineNumber = endFoldLine.lineNumber;
        return new vscode.Range(line.lineNumber+1, 0, endLineNumber-1, 0);
    }

    export function makeRangeDocument(document: vscode.TextDocument) {
        const rangeLastLine = document.lineAt(document.lineCount - 1).range.end;
        return new vscode.Range(new vscode.Position(0,0), new vscode.Position(rangeLastLine.line, rangeLastLine.character));
    }

    export function makeRangeFromLineToEnd(document: vscode.TextDocument, lineStart:number) {
        const rangeLastLine = document.lineAt(document.lineCount - 1).range.end;
        return new vscode.Range(new vscode.Position(lineStart,0), new vscode.Position(rangeLastLine.line, rangeLastLine.character));
    }

    export function makeRangeFromStartToLine(document: vscode.TextDocument, lineEnd:number) {
        const rangeLastLine = document.lineAt(lineEnd).range.end;
        return new vscode.Range(new vscode.Position(0,0), new vscode.Position(rangeLastLine.line, rangeLastLine.character));
    }

    export function expandRangeFullLineWidth(document: vscode.TextDocument, range: vscode.Range) {
        return new vscode.Range(range.start.line, 0, range.end.line, document.lineAt(range.end.line).text.length);
    }

    export function expandRangeDocumentIfEmpty(textEditor: vscode.TextEditor, range: vscode.Range) {
        if (range.isSingleLine && range.start.character === range.end.character) {
            return makeRangeDocument(textEditor.document);
        }
        return range;
    }

    export function expandRangeToBlockIfEmpty(textEditor: vscode.TextEditor, range: vscode.Range) {
        if (range.isSingleLine && range.start.character === range.end.character) {

            const firstLineOfBlock = Lines.findFirstLineOfBlock(textEditor.document, range.start.line, line => !line.isEmptyOrWhitespace);
            const lastLineOfBlock = Lines.findLastLineOfBlock(textEditor.document, range.start.line, line => !line.isEmptyOrWhitespace);
            return new vscode.Range(new vscode.Position(firstLineOfBlock.lineNumber,0), new vscode.Position(lastLineOfBlock.lineNumber, lastLineOfBlock.range.end.character));
        }
        return range;
    }

    export function makeVerticalRangesWithinBlock(textEditor: vscode.TextEditor, ranges: vscode.Range[]) {
        if (ranges.length > 1) return ranges;

        const range = ranges[0];
        if (range.isSingleLine && range.start.character === range.end.character) {

            const firstLineOfBlock = Lines.findFirstLineOfBlock(textEditor.document, range.start.line, line => !line.isEmptyOrWhitespace);
            const lastLineOfBlock = Lines.findLastLineOfBlock(textEditor.document, range.start.line, line => !line.isEmptyOrWhitespace);
            const cursorColumn = Lines.calculateColumnFromCharIndex(textEditor.document.lineAt(range.start.line).text, range.start.character, +textEditor.options.tabSize);

            const ranges:vscode.Range[] = [];
            for(let lineIndex = firstLineOfBlock.lineNumber; lineIndex <= lastLineOfBlock.lineNumber; lineIndex++) {
                const line = textEditor.document.lineAt(lineIndex);
                const charIndex = Lines.calculateCharIndexFromColumn(line.text, cursorColumn,  +textEditor.options.tabSize);
                ranges.push(new vscode.Range(new vscode.Position(line.lineNumber,charIndex), new vscode.Position(line.lineNumber, charIndex)));
            }
            return ranges;
        }
        return [range];
    }

    export function makeSelectionsFromRanges(ranges: vscode.Range[]) {
        return ranges.map(range=>new vscode.Selection(range.start.line, range.start.character,range.start.line, range.start.character))
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
}

export namespace Lines {
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

    export function linesFromRanges(document: vscode.TextDocument, ranges: Array<vscode.Range>) {
        return ranges.map( range => linesFromRange(document, range) ).reduce( (acc, cur) => acc.concat(cur));
    }

    export function linesFromRange(document: vscode.TextDocument, range: vscode.Range) {
        const startLine = range.start.line;
        const endLine = range.end.line;

        return collectLines(document, startLine, endLine);
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
        for(let lineIndex = range.start.line; lineIndex < totalLines + range.start.line; lineIndex++) {

            const line = document.lineAt(lineIndex);
            if (filter(line.text)) {
                filteredLines.push(line);
            }
        }
        return filteredLines;
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

    export function findNextLineUpSpacedLeft(document: vscode.TextDocument, lineNumber: number, tabSize:number) {
        const line = document.lineAt(lineNumber);
        let lastSpacing = calculateLineSpacing(line.text, tabSize);
        for(let index = lineNumber; index >= 0; index--) {
            const line = document.lineAt(index);
            if ( !line.isEmptyOrWhitespace ) {
                const currentSpacing = calculateLineSpacing(line.text, tabSize);
                if (currentSpacing < lastSpacing) return line;
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

    export function findAllLineNumbersContaining(document: vscode.TextDocument, text: RegExp) {
        let lineNumbers = Array<number>();
        for (let index = 0; index < document.lineCount; index++) {
            const line = document.lineAt(index);
            if (line.text.search(text) > -1) lineNumbers.push(line.lineNumber);
        }
        return lineNumbers;
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

    export function findLinesByLevelToRoot(document: vscode.TextDocument, lineNumber: number, tabSize:number) {
        const lines = [document.lineAt(lineNumber)];
        let nextLine = findNextLineUpSpacedLeft(document, lineNumber, tabSize);
        while(nextLine) {
            lines.push(nextLine);
            nextLine = findNextLineUpSpacedLeft(document, nextLine.lineNumber, tabSize);
        }
        return lines;
    }

    export function findAllLinesContainingCurrentWordOrSelection() {
        const textEditor = vscode.window.activeTextEditor;
        const selection = textEditor.selection;
        const regExForFold = makeRegExpToMatchWordUnderCursorOrSelection(textEditor.document, selection);
        return findAllLineNumbersContaining(textEditor.document, regExForFold);
    }

    export function makeRegExpToMatchWordUnderCursorOrSelection(document: vscode.TextDocument, selection: vscode.Selection) {
        let range = selection as vscode.Range;
        if (selection.isEmpty) {
            range = document.getWordRangeAtPosition(new vscode.Position(selection.anchor.line, selection.anchor.character));
            return new RegExp('\\b' + document.getText(range) + '\\b');
        } 
        return new RegExp(document.getText(range));
    }

    export function calculateLineLevel(textEditor: vscode.TextEditor, lineNumber: number) {
        let level = 1;
        let nextLine = findNextLineUpSpacedLeft(textEditor.document, lineNumber, +textEditor.options.tabSize);
        while(nextLine) {
            level++;
            nextLine = findNextLineUpSpacedLeft(textEditor.document, nextLine.lineNumber, +textEditor.options.tabSize);
        }
        return level;
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

    export function textFromLines(document: vscode.TextDocument, lines: Array<vscode.TextLine>) {
        return lines.map(line=>line.text).reduce((text, lineText)=> text + lineText+'\n', '')
    }
}

export namespace Modify {
    export function replaceLinesWithText(textEditor: vscode.TextEditor, linesOld: Array<vscode.TextLine>, linesNew: Array<string>) {
        textEditor.edit(function (editBuilder) {
            let lineIndex = 0;
            linesOld.forEach(line => {
                editBuilder.replace(line.range, linesNew[lineIndex]);
                lineIndex++;
            });
        })
    }
    
    export function reverseLines(textEditor: vscode.TextEditor, ranges: Array<vscode.Range>) {
        if(ranges.length === 1) {
            const linesToReverse = Lines.linesFromRange(textEditor.document, Region.expandRangeToBlockIfEmpty(textEditor, ranges[0]));
            const reversedLines = linesToReverse.slice(0);
            linesToReverse.reverse();
            replaceLines(textEditor, linesToReverse, reversedLines);
        } else {
            const linesToReverse = Lines.linesFromRanges(textEditor.document, ranges);
            const reversedLines = linesToReverse.slice(0);
            linesToReverse.reverse();
            replaceLines(textEditor, linesToReverse, reversedLines);
        }
    };
    
    export function replaceLines(textEditor: vscode.TextEditor, linesOld: Array<vscode.TextLine>, linesNew: Array<vscode.TextLine>) {
        replaceLinesWithText(textEditor, linesOld, linesNew.map(line=>line.text));
    }
    
    export function sortLinesWithinRange(textEditor: vscode.TextEditor, range: vscode.Range) {
        const lines = Lines.linesFromRange(textEditor.document, range);
        const sortedLines = orderby(lines, ['text'], null, null);
    
        replaceLines(textEditor, lines, sortedLines);
    }
    
    export function sortLinesByLength(textEditor: vscode.TextEditor, lines: vscode.TextLine[]) {
        const sortedLines = orderby(lines, ['text.length'], null, null);
        replaceLines(textEditor, lines, sortedLines);
    }
    
    export function sortLinesByColumn(textEditor: vscode.TextEditor, ranges: Array<vscode.Range>) {
        const lines = Lines.makeLineInfos(textEditor, ranges);
        
        const sortedLines = orderby(lines, [line => Region.textFromRangeOrCursorToEndLine(line.line.text, line.range)], null, null);
    
        replaceLines(textEditor, lines.map(line => line.line), sortedLines.map(line => line.line));
        // when we sort the lines, selections are not moved with the lines
        // we update the selections here to match the moved lines
        const updatedRanges = makeRangesFromCombined(textEditor, lines.map(line => line.range), sortedLines.map(line => line.range));
        textEditor.selections = updatedRanges.map(range => new vscode.Selection(range.start, range.end));
    }
    /**
     * Combines the line numbers of a set of ranges with the character positions of another set of ranges
     * @param textEditor 
     * @param rangesLinesSource 
     * @param rangesCharPosSource 
     */
    function makeRangesFromCombined(textEditor: vscode.TextEditor, rangesLinesSource: Array<vscode.Range>, rangesCharPosSource: Array<vscode.Range>) {
        const newRanges = [];
        let lineIndex = 0;
        rangesLinesSource.forEach(rangeLineSource => {
            const ranchCharSource = rangesCharPosSource[lineIndex];
            newRanges.push(new vscode.Range(new vscode.Position(rangeLineSource.start.line, ranchCharSource.start.character), new vscode.Position(rangeLineSource.end.line, ranchCharSource.end.character)));
            lineIndex++;
        });

        return newRanges;
    }
    export function replace(textEditor: vscode.TextEditor, range: vscode.Range, blockText: string) {
        textEditor.edit(function (editBuilder) {
            editBuilder.replace(range, blockText);
        });
    }
}

export namespace View {
    export function createGutterDecorator(lineNumber:number, contentText:string, width:string):vscode.DecorationOptions {
        const posStart = new vscode.Position(lineNumber,0);
        
        return {
            range: new vscode.Range(posStart, posStart), 
            renderOptions: {
                before: {contentText, width, backgroundColor: new vscode.ThemeColor('editor.lineHighlightBackground'), color: new vscode.ThemeColor('badge.foreground')} 
            }
        };
    }

    export function createCursorDecoratorType() {
        return vscode.window.createTextEditorDecorationType({
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
            borderColor: new vscode.ThemeColor('badge.foreground'),
            borderWidth:'1px',
            borderStyle:'solid'
        });
    }
    export function createCursorDecorator(lineNumber:number, column:number):vscode.DecorationOptions {
        const posStart = new vscode.Position(lineNumber,column);
        return {
            range: new vscode.Range(posStart, posStart)
        };
    }

    export function addMarkdownCommandLink(markdownString:MarkdownString, linkName:string, commandId:string, parameters:object) {
        const uri = encodeURI('command:'+commandId+'?' + JSON.stringify(parameters))
        markdownString.appendMarkdown('['+linkName+']('+uri+')');
        markdownString.isTrusted = true;
        return markdownString;
    }

    export function makeFilterFunction(filter:string) {
        let fnFilter:(lineText:string)=>boolean;
        if (filter.charAt(0) === ' ') fnFilter = (lineText:string) => lineText.includes(filter.substring(1));
        else {
            const regex = new RegExp(filter, 'i');
            fnFilter = (lineText:string) => regex.test(lineText);
        }
        return fnFilter;
    }

    export function promptForFilterExpression(defaultValue:string):Thenable<(lineText: string) => boolean> {
        return vscode.window.showInputBox({value: defaultValue, prompt: 'Enter regex or [space] + literal'})
            .then(filter => makeFilterFunction(filter))
    }

    export interface QuickPickActionable extends vscode.QuickPickItem {
        input?: vscode.InputBoxOptions
        value?: any
        final?: boolean // closes and returns result on selection
        children?: QuickPickActionable[] | (()=>Thenable<QuickPickActionable[]>)
    }

    export class QuickPickActionableReactive implements QuickPickActionable {
        label
        description
        detail
        input: vscode.InputBoxOptions
        private _value
        get value() {return this._value}
        set value(value) {
            this._value = value
            if (value instanceof QuickPickActionableReactive)
                this.detail = 'value: ' + value.label
            else
                this.detail = 'value: ' + this._value
        } 
    }

    export function makeOption(item:QuickPickActionable) {
        const quickPickReactive = new QuickPickActionableReactive()
        return Object.assign(quickPickReactive, item)
    }

    export enum QuickPickActionType {
        SHOW,
        INPUT,
        ENTER,
        SELECT // not yet implemented
    }

    export function promptOptions(items:QuickPickActionable[], onChange?:(item:QuickPickActionable, action:QuickPickActionType)=>any):Thenable<QuickPickActionable|void> {
        if (onChange) onChange(null, QuickPickActionType.SHOW)
        return vscode.window.showQuickPick(items, {ignoreFocusOut:true}).then(item=>{
            if (!item) return null
            if (item.children) {
                let resolveChildren:Thenable<QuickPickActionable[]>
                if (typeof item.children === 'function')
                    resolveChildren = item.children()
                else
                    resolveChildren = Promise.resolve(item.children as QuickPickActionable[]) // convert value to promise
                return resolveChildren.then(children=>{
                    promptOptions(children).then(selectedChild=>{
                        if (item.value != selectedChild) {
                            item.value = selectedChild
                            if (onChange) onChange(item, QuickPickActionType.ENTER)
                        }
                        return promptOptions(items, onChange)
                    })
                })
            } else if (item.input) {
                item.input.value = item.value
                item.input.ignoreFocusOut = true;
                item.input.validateInput = (input)=> {
                    if (item.value != input) {
                        item.value = input;
                        // allows responding to characters as they are typed into the input box
                        if (onChange)
                            return onChange(item, QuickPickActionType.INPUT)
                    }
                    return null
                }
                if (!item.input.prompt) item.input.prompt = item.description
                return vscode.window.showInputBox(item.input).then(inputText=>{
                    if (item.input.value != inputText) {  // has the original value changed?
                        item.value = inputText
                        if (onChange) onChange(item, QuickPickActionType.ENTER)
                    }
                    if (!item.final) {
                        return promptOptions(items, onChange)
                    } 
                    return item
                })
            } else if (item.value === false || item.value === true) {
                item.value =! item.value
                if (onChange) onChange(item, QuickPickActionType.ENTER)
                return promptOptions(items, onChange)
            }
            if (onChange) onChange(item, QuickPickActionType.ENTER)
            return item
        })
    }

    let openedDocuments = [] as vscode.TextDocument[]
    vscode.workspace.onDidCloseTextDocument(closedDocument => {
        const closedIndex = openedDocuments.indexOf(closedDocument);
        if (closedIndex === -1) return
        openedDocuments = openedDocuments.splice(closedIndex, 1)
    })
    /**
     * Open new document if not already open.
     * Show document in next editor group if not specified
     * @param name 
     * @param content 
     * @param preserveFocus 
     */
    export async function openShowDocument(name: string, content: string, preserveFocus=true, viewColumn?:number) {
        if (!viewColumn)
            viewColumn = vscode.window.activeTextEditor.viewColumn === 3 ? 2 : 1 + vscode.window.activeTextEditor.viewColumn

        let editor:vscode.TextEditor
        let document = openedDocuments.find(openDocument => openDocument.fileName === name)
        if (!document) {
            document = await vscode.workspace.openTextDocument(vscode.Uri.parse('untitled:'+name))
            openedDocuments.push(document)
            editor   = await vscode.window.showTextDocument(document, viewColumn, preserveFocus)
        } else {
            editor   = visibleTextEditorFromDocument(document)
            if (!editor)
                editor = await vscode.window.showTextDocument(document, viewColumn, preserveFocus)
        }

        const originalSelection = editor.selection
        Modify.replace(editor, Region.makeRangeDocument(editor.document), content)
        editor.selection = originalSelection
        return editor;

    }

    export function visibleTextEditorFromDocument(document:vscode.TextDocument) {
        return vscode.window.visibleTextEditors.find(editor=>editor.document===document)
    }

    export function visibleTextEditorByColumn(column:number) {
        return vscode.window.visibleTextEditors.find(editor=>editor.viewColumn === column)
    }    
    export function setFocusOnEditorColumn(column:number) {
        let command
        switch (column) {
            case 1: command = 'workbench.action.focusFirstEditorGroup' ;break
            case 2: command = 'workbench.action.focusSecondEditorGroup';break
            case 3: command = 'workbench.action.focusThirdEditorGroup' ;break
        }
        return vscode.commands.executeCommand(command)
    }
    export function triggerWordHighlighting() {
        // Move the cursor so that vscode will reapply the word highlighting
        vscode.commands.executeCommand('cursorLeft');
        vscode.commands.executeCommand('cursorRight');
    }

    export interface LiveDocumentViewEvent {
        sourceEditor:vscode.TextEditor
        scriptEditor:vscode.TextEditor
        viewEditor:vscode.TextEditor
        eventOrigin:'source'|'script'
        eventType:'selection'|'edit'
        editChanges?:vscode.TextDocumentContentChangeEvent[]
        scriptCursorMoved?: 'vertical'|'horizontal'
    }
    export type LiveViewUpdater = (textEditor: vscode.TextEditor, range: vscode.Range, blockText: string)=>Thenable<boolean>
    export type LiveViewRenderer = (update:LiveViewUpdater, event:LiveDocumentViewEvent)=>void

    function isEventTriggeredFromSelf(event:vscode.TextDocumentChangeEvent) {
        console.log('events', event.contentChanges.length)
        return event.contentChanges.length === 2;
    }

    export async function liveDocumentView(documentName:string, initialContent:string, viewRenderer:LiveViewRenderer) {
        let lastActiveSourceDocument = vscode.window.activeTextEditor.document
        function updateView(textEditor: vscode.TextEditor, range: vscode.Range, blockText: string) {
            return textEditor.edit(function (editBuilder) {
                editBuilder.replace(range, blockText);
            }, {undoStopAfter:false, undoStopBefore:false});
        }
        const scriptEditor = await openShowDocument('Macro Script.js', initialContent, false)
        const viewEditor   = await openShowDocument('Macro Preview.' + Application.documentExtension(lastActiveSourceDocument), '', false)
        const scriptDocument = scriptEditor.document
        const viewDocument   = viewEditor.document
        let lastScriptSelection = scriptEditor.selection

        vscode.workspace.onDidChangeTextDocument(event=> {
            if (event.document === viewDocument) return 
            const scriptEditor = visibleTextEditorFromDocument(scriptDocument)
            const sourceEditor = visibleTextEditorFromDocument(lastActiveSourceDocument)
            if (!scriptEditor || !sourceEditor) return // not visible, nothing to do
            viewRenderer(updateView, {
                sourceEditor: sourceEditor,
                scriptEditor: scriptEditor,
                viewEditor:viewEditor,
                eventOrigin: event.document===scriptDocument?'script':'source',
                eventType:'edit',
                editChanges:event.contentChanges
            })
        })
        vscode.window.onDidChangeTextEditorSelection(event=> {
            if (event.kind === undefined) return // selection caused by updating view
            if (event.textEditor.document === viewDocument) return 
            const scriptEditor = visibleTextEditorFromDocument(scriptDocument)
            const sourceEditor = visibleTextEditorFromDocument(lastActiveSourceDocument)
            if (!scriptEditor || !sourceEditor) return // not visible, nothing to do
            const eventOrigin = event.textEditor.document===scriptDocument?'script':'source'
            let cursorMoved
            if (eventOrigin === 'script') {
                if (lastScriptSelection.active.line !== scriptEditor.selection.active.line) {
                    cursorMoved = 'vertical'
                } else {
                    cursorMoved = 'horizontal'
                }
                lastScriptSelection = scriptEditor.selection
            }
            
            viewRenderer(updateView, {
                sourceEditor: sourceEditor,
                scriptEditor: scriptEditor,
                viewEditor:viewEditor,
                eventOrigin,
                eventType:'selection',
                scriptCursorMoved: cursorMoved
            })
        })            
        vscode.window.onDidChangeActiveTextEditor(event=> {
            // when switching documents a selection change event is also sent most of the time
            // if we update the document on this event, the selections will be wrong
            // TODO - need to investigate work arounds to make the behavior more reliable
            // but we are impared by vscodes unreliable behavior in this case
            if (event.document !== scriptDocument && event.document !== viewDocument)
                lastActiveSourceDocument = event.document
        })
    }

    export interface DocumentWatchEvent {
        editor: vscode.TextEditor
        eventType: 'selection'|'edit'
        editChanges?: vscode.TextDocumentContentChangeEvent[]
        cursorMoved?: 'vertical'|'horizontal'
    }
    export interface DocumentWatcher {
        dispose()
        document: vscode.TextDocument
    }
    export function watchDocument(document:vscode.TextDocument, onEvent:(event:DocumentWatchEvent)=>void): DocumentWatcher {
        const disposables = [] as vscode.Disposable[]
        const documentEditor = visibleTextEditorFromDocument(document)
        let lastEditorSelection = documentEditor.selection

        disposables.push(vscode.workspace.onDidChangeTextDocument(event=> {
            if (event.document !== document) return
            const editor = visibleTextEditorFromDocument(document)
            if (!editor) return // not visible, nothing to do
            onEvent({
                editor,
                eventType: 'edit',
                editChanges: event.contentChanges
            })
        }))

        disposables.push(vscode.window.onDidChangeTextEditorSelection(event=> {
            if (event.kind === undefined) return // selection caused by programmitc updating view
            if (event.textEditor.document !== document) return
            const editor = visibleTextEditorFromDocument(document)
            if (!editor) return // not visible, nothing to do

            let cursorMoved
            if (lastEditorSelection.active.line !== editor.selection.active.line) {
                cursorMoved = 'vertical'
            } else {
                cursorMoved = 'horizontal'
            }
            lastEditorSelection = editor.selection

            onEvent({
                editor,
                eventType: 'selection',
                cursorMoved
            })
        }))

        disposables.push(vscode.workspace.onDidCloseTextDocument(closedDocument=> {
            if (document !== closedDocument) return
            dispose()
        }))
        
        function dispose() {
            disposables.forEach(disposable=>disposable.dispose())
        }

        return {dispose, document}
    }

    export function makeCodeLens(title:string, line:number, column:number, onClick:Function) {
        return new vscode.CodeLens(new vscode.Range(line,column,line,column), {title, command:'dakara-internal.oncommand', arguments: [onClick]})
    }
    
    export interface TreeItemRoot extends TreeWithChildren {}
    export type TreeWithChildren = {
        parent?: TreeWithChildren
        children?: TreeItemActionable[] | (()=>Thenable<TreeItemActionable[]>)
    }
    export type TreeItemActionable = TreeWithChildren & vscode.TreeItem
    export function makeTreeViewManager(context: vscode.ExtensionContext, viewId:string, rootTreeItem?: TreeItemActionable) {
        if (!rootTreeItem) rootTreeItem = {}
        let selected;
        const emitter = new vscode.EventEmitter<string | null>();
        const provider = {
            onDidChangeTreeData: emitter.event,
            getChildren: element=> {
                const treeItemActionable = element as TreeItemActionable
                let children = rootTreeItem.children;
                if (element)
                    children = treeItemActionable.children
    
                if (!children) return;

                if (children instanceof Function)
                    return Promise.resolve(children())
                else 
                    return Promise.resolve(children)
            },
            getTreeItem: (treeItem:TreeItemActionable) => {
                if (treeItem.children && !treeItem.collapsibleState)
                    treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed
                return treeItem
            },
            getParent: (treeItem:TreeItemActionable) => treeItem.parent
        }
    
        const treeView = vscode.window.createTreeView(viewId, {treeDataProvider: provider});

        function _findTreeItem(currentItem: TreeItemActionable, isFound: (treeItem) => boolean): TreeItemActionable {
            if (isFound(currentItem)) return currentItem;

            if (currentItem.children instanceof Array) {
                for(const childItem of currentItem.children) {
                    const item = _findTreeItem(childItem, isFound)
                    if (item) return item
                }
            }
        }
        function findTreeItem(isFound: (treeItem:TreeItemActionable) => boolean): TreeItemActionable {
            return _findTreeItem(rootTreeItem, isFound)
        }

    
        return {treeView, rootTreeItem, findTreeItem, update: emitter.fire.bind(emitter)};
    }

    export function registerIcons(context: vscode.ExtensionContext, basepath:string) {
        let paths = FS.readdirSync(context.asAbsolutePath(Path.join(basepath, 'light')))
        paths.map(path => Path.basename(path)).forEach(path => {
            if (path.endsWith('.svg'))
                ICON_PATHS.set(path.substring(0, path.length - 4) + '.light', context.asAbsolutePath(Path.join(basepath, 'light', path)))
        })
    
        paths = FS.readdirSync(context.asAbsolutePath(Path.join(basepath, 'dark')))
        paths.map(path => Path.basename(path)).forEach(path => {
            if (path.endsWith('.svg'))
                ICON_PATHS.set(path.substring(0, path.length - 4) + '.dark', context.asAbsolutePath(Path.join(basepath, 'dark', path)))
        })
    
    }    

    export function makeIconPaths(iconId:string) {
        return {
            light: ICON_PATHS.get(iconId + '.light'),
            dark: ICON_PATHS.get(iconId + '.dark')
        }
    }
}



export namespace Application {
    export function documentExtension(document:vscode.TextDocument) {
        return document.fileName.substr(document.fileName.lastIndexOf('.') + 1)
    }

    export function userSettingsPath() {
        const os = require("os");

        let PATH = process.env.APPDATA;
        if (PATH) {
            if (process.platform == 'darwin') {
                PATH = process.env.HOME + '/Library/Application Support';
            } else if (process.platform == 'linux') {
                PATH = os.homedir() + '/.config';
            } else {
                PATH = '/var/local';
            }
        }

        return PATH + '/Code/User/'
    }

    /**
     * Cycle through a set of possible settings values for whatever is the most local defined scope
     * @param values 
     * @param section 
     * @param property 
     */
    export async function settingsCycleNext(section:string, property:string, values: any[]) {
        const settingsConfig = vscode.workspace.getConfiguration(section).inspect(property)
        let targetScope = vscode.ConfigurationTarget.Global
        if (settingsConfig.workspaceValue) targetScope = vscode.ConfigurationTarget.Workspace
        if (settingsConfig.workspaceFolderValue) targetScope = vscode.ConfigurationTarget.WorkspaceFolder

        const currentValue = vscode.workspace.getConfiguration(section).get(property)
        const valueIndex = values.indexOf(currentValue)
        const nextIndex = valueIndex === values.length - 1 ? 0 : valueIndex + 1
        const nextValue = values[nextIndex]
        
        await vscode.workspace.getConfiguration(section).update(property, nextValue, targetScope)
        return nextValue
    }

}

// set context for 'when' expressions in configuration options
// vscode.commands.executeCommand('setContext', 'myExtKey', true)