import BibliographyManager from "main";
import { MarkdownPostProcessorContext } from "obsidian";



function addMarkdownBlockProcessors(this: BibliographyManager) {
    const processors: {language: string, handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void | Promise<any>}[] = [
    ]

    for (const processor of processors) {
        this.registerMarkdownCodeBlockProcessor(processor.language, processor.handler);
    }
}

export { addMarkdownBlockProcessors };