// Read focused delivery evidence without inventing omitted cards or empty fields.
export const contextCards = event => [...new Map([...event.context.focus, ...event.context.related].map(node => [node.id, node])).values()];
export const focusCard = event => event.context.focus.find(node => node.id === event.id);
export const discussionChat = event => focusCard(event).chat || [];
