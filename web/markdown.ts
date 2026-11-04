import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import type { Element, Root } from 'hast';

function responseElements() {
  return (tree: Root) => {
    function visit(parent: Root | Element) {
      parent.children = parent.children.map(node => {
        if (node.type !== 'element') return node;
        visit(node);
        if (node.tagName === 'a') {
          node.properties.target = '_blank';
          node.properties.rel = ['noopener', 'noreferrer'];
        }
        if (node.tagName !== 'pre') return node;
        const wrapper: Element = {
          type: 'element', tagName: 'div', properties: {className: ['code-block']}, children: [
            {type: 'element', tagName: 'button', properties: {className: ['quiet'], type: 'button'}, children: [{type: 'text', value: 'Copy'}]},
            node,
          ],
        };
        return wrapper;
      });
    }
    visit(tree);
  };
}

const processor = unified().use(remarkParse).use(remarkRehype).use(rehypeSanitize).use(responseElements).use(rehypeStringify);

export function renderMarkdown(text: string): string {
  return String(processor.processSync(text));
}

// Artifact content may be inspected without following links or fetching images.
function artifactElements() {
  return (tree: Root) => {
    function visit(parent: Root | Element) {
      parent.children = parent.children.map(node => {
        if (node.type !== 'element') return node;
        if (node.tagName === 'img') return {type:'text' as const, value:String(node.properties.alt ?? '')};
        if (node.tagName === 'a') { delete node.properties.href; delete node.properties.target; delete node.properties.rel; }
        visit(node);
        return node;
      });
    }
    visit(tree);
  };
}
const artifactProcessor = unified().use(remarkParse).use(remarkRehype).use(rehypeSanitize).use(artifactElements).use(rehypeStringify);
export function renderArtifactMarkdown(text:string):string {return String(artifactProcessor.processSync(text));}
