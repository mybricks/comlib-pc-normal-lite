const visualEditInstructions = [
  'All DOM operations come from visual drag-and-drop actions. Prefer making the changes directly so the user can see the result. If there is a clear risk, you may consult the user or recommend how to proceed.',
  'Do not refer to nodes as Dom1 or Dom2 when speaking to the user; use more intuitive descriptions such as “the Save button” instead.',
].join('\n')

export function appendVisualEditInstructions(message: string): string {
  return `${message}\n\n${visualEditInstructions}`
}
