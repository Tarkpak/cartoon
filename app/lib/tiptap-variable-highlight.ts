import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

function buildVariableDecorations(doc: ProseMirrorNode, validVars: Set<string>): DecorationSet {
  const decorations: Decoration[] = []

  doc.descendants((node, pos) => {
    if (!node.isText) return

    const text = node.text || ''
    const matcher = /\{\{(\w+)\}\}/g

    for (const match of text.matchAll(matcher)) {
      const variableName = match[1]
      const startOffset = match.index
      if (!variableName || startOffset === undefined) continue

      const start = pos + startOffset
      const end = start + match[0].length

      decorations.push(
        Decoration.inline(start, end, {
          'class': validVars.has(variableName) ? 'variable-tag valid' : 'variable-tag invalid',
          'data-variable': variableName
        })
      )
    }
  })

  return DecorationSet.create(doc, decorations)
}

function createVariableHighlightPlugin(getValidVars: () => Set<string>) {
  return new Plugin({
    key: new PluginKey('variableHighlight'),
    state: {
      init(_, { doc }) {
        return buildVariableDecorations(doc, getValidVars())
      },
      apply(transaction, oldState) {
        if (!transaction.docChanged) {
          return oldState
        }

        return buildVariableDecorations(transaction.doc, getValidVars())
      }
    },
    props: {
      decorations(state) {
        return this.getState(state)
      }
    }
  })
}

export function createPromptVariableHighlight(getValidVars: () => Set<string>) {
  return Extension.create({
    name: 'variableHighlight',
    addProseMirrorPlugins() {
      return [createVariableHighlightPlugin(getValidVars)]
    }
  })
}
