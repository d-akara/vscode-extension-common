import * as vscode from 'vscode';
import { Region, Lines, Disposable, makeDisposable} from './EditorFunctions'

export interface DecorationContainer extends Disposable {
    addType(id: string, type:vscode.DecorationRenderOptions)
    addDecorator(typeId: string, decorator: vscode.DecorationOptions | vscode.Range)
    renderAndFlush(activeEditor: vscode.TextEditor)
    dispose() 
}

export interface DecoratorTypeAndDecorators {
    type: vscode.TextEditorDecorationType
    decorators: vscode.DecorationOptions[] | vscode.Range[] 
}

export function makeDecorationContainer():DecorationContainer {
    const decoratedEditors = new Set<vscode.TextEditor>()
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
            decoratedEditors.add(activeEditor)
            decoratorTypes.forEach(decorationType => {
                activeEditor.setDecorations(decorationType.type, decorationType.decorators);
                decorationType.decorators = [] // flush for next use.
            });
        }, 

        dispose() {
            decoratedEditors.forEach(editor => {
                decoratorTypes.forEach(decorationType => {
                    decorationType.decorators = []
                    editor.setDecorations(decorationType.type, decorationType.decorators);
                });
            })
            decoratedEditors.clear()
            decoratorTypes.clear()
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

        triggerUpdateDecorations(activeEditor);
    }, null, disposables);

    vscode.window.onDidChangeTextEditorVisibleRanges(event => {
        if (!activeEditor || !shouldDecorateDocument(activeEditor)) return

        if (event.visibleRanges.length > 0) {
            triggerUpdateDecorations(activeEditor);
        }       
    }, null, disposables)

    let timeout = null;
    function triggerUpdateDecorations(editor:vscode.TextEditor) {
        if (timeout) {clearTimeout(timeout)}

        timeout = setTimeout(()=> {
            timeout = null;
            updateDecorations(editor, decorationContainer)
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

    // colorize on initial activation
    vscode.window.visibleTextEditors.forEach(editor => {
        if (shouldDecorateDocument(editor)) {
            triggerUpdateDecorations(editor)
        }
    })

    return makeDisposable(disposables, ()=> decorationContainer.dispose())
}
