import * as vscode from 'vscode';
import { Region, Lines, Disposable, makeDisposable} from './EditorFunctions'

export interface DecorationContainer {
    addType(id: string, type:vscode.DecorationRenderOptions)
    addDecorator(typeId: string, decorator: vscode.DecorationOptions | vscode.Range)
    renderAndFlush(activeEditor: vscode.TextEditor)
}

export interface DecoratorTypeAndDecorators {
    type: vscode.TextEditorDecorationType
    decorators: vscode.DecorationOptions[] | vscode.Range[] 
}

export function makeDecorationContainer():DecorationContainer {
    const decoratorTypes: Map<string, DecoratorTypeAndDecorators> = new Map()
    return {
        addType(id: string, type:vscode.DecorationRenderOptions) {
            const typeAndDecorators = {
                type: vscode.window.createTextEditorDecorationType(type),
                decorators: []
            } as DecoratorTypeAndDecorators
            decoratorTypes.set(id, typeAndDecorators)
        },

        addDecorator(typeId: string, decorator: vscode.DecorationOptions | vscode.Range) {
            decoratorTypes.get(typeId).decorators.push(decorator as any)
        },

        renderAndFlush(activeEditor: vscode.TextEditor) {
            decoratorTypes.forEach(decorationType => {
                activeEditor.setDecorations(decorationType.type, decorationType.decorators);
                decorationType.decorators = [] // flush for next use.
            });
        }
    }
}

export type ApplyDecoratorFn = (activeEditor: vscode.TextEditor, line: number, decorationContainer: DecorationContainer) => void
export function activateViewportDecorators(decorationContainer: DecorationContainer, shouldDecorateDocument: (editor) => boolean, decorateLine: ApplyDecoratorFn): Disposable {
    const disposables = [] as Disposable[]
    let activeEditor = vscode.window.activeTextEditor;
    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (!editor) return
        activeEditor = editor;
        if (!shouldDecorateDocument(activeEditor)) return

        triggerUpdateDecorations();
    }, null, disposables);

    vscode.window.onDidChangeTextEditorVisibleRanges(event => {
        if (!activeEditor || !shouldDecorateDocument(activeEditor)) return

        if (event.visibleRanges.length > 0) {
            triggerUpdateDecorations();
        }       
    }, null, disposables)

    let timeout = null;
    function triggerUpdateDecorations(contentChanges?: readonly vscode.TextDocumentContentChangeEvent[]) {
        if (timeout) {clearTimeout(timeout)}

        timeout = setTimeout(()=> {
            timeout = null;
            updateDecorations(activeEditor, decorationContainer)
        }, 100);
    }

    function updateDecorations(activeEditor:vscode.TextEditor,  decorationContainer: DecorationContainer) {
        if (!activeEditor) {return}
    
        const regionToUpdate = Region.makeExpandedVisibleRange(activeEditor, 50)
        Lines.forEachLineNumberOfRange(regionToUpdate, line => {
            decorateLine(activeEditor, line, decorationContainer);
        })
    
        decorationContainer.renderAndFlush(activeEditor)
    }
    
    return makeDisposable(disposables)
}
