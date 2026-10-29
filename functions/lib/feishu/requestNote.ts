// The first note of a ticket made from a Feishu ticket request (pure): the
// details as staff checked them, then the customer's own words marked as from
// Feishu — or just the mark and the words when there are no details. Written
// by the card route; read back by the requirement pool and similar tickets.

export const FROM_FEISHU = "From Feishu:";

export const requestNote = (details: string, words: string) =>
  details ? `${details}\n\n${FROM_FEISHU}\n${words}` : `${FROM_FEISHU} ${words}`;

// The customer's words of a note written without details; "" for any other note.
export const customerWordsOf = (note: string) => (note.startsWith(FROM_FEISHU) ? note.slice(FROM_FEISHU.length).trimStart() : "");
