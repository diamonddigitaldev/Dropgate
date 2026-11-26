// The house's copy rules on what a window shows now (client/test/helpers/copy.mjs'
// copySlips(): one-character ellipses, no "card", a capital after a colon,
// bullet-separated items in Title Case), with names (files, addresses, adapters)
// read as they are. The desktop specs check each screen they reach with it.
import { copySlips } from '../../../client/test/helpers/copy.mjs';

/** The words the window shows now: each visible element's own text, and its aria-label, title and placeholder. */
const shownWords = (window) => window.evaluate(() => {
    const words = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    for (let element = walker.currentNode; element; element = walker.nextNode()) {
        if (!(element instanceof HTMLElement) || !element.checkVisibility()) continue;
        if (element.classList.contains('material-icons-round')) continue;
        const own = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join('').trim();
        if (own) words.push(own);
        for (const attribute of ['aria-label', 'title', 'placeholder']) {
            if (element.getAttribute(attribute)) words.push(element.getAttribute(attribute));
        }
    }
    return words;
});

/** What a screen shows that breaks the copy rules, the names given read as names. */
export async function copySlipsShown(window, names, where) {
    return (await shownWords(window)).flatMap((text) => copySlips(text, { names }).map((reason) => `${where}: ${reason} in "${text}"`));
}
